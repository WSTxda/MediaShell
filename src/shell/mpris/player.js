/**
 * @file player.js
 * @module shell.mpris.player
 *
 * Models one MPRIS player endpoint owned by a session-bus service.
 *
 * Each instance owns the root, Player, and Properties D-Bus proxies, cached
 * player properties, metadata
 * stabilization, position tracking, and command forwarding for one bus name.
 * The lifecycle is asynchronous because browser-backed MPRIS endpoints can
 * publish a bus before their properties are ready.
 *
 * State machine:
 *   [created]
 *       │ init() called
 *       ▼
 *   [initializing] ── timeout ──► [invalid]
 *       │ proxies ready + identity/metadata confirmed
 *       ▼
 *   [valid / empty-stopped-grace / invalid]
 *       │ PropertiesChanged signal
 *       ▼
 *   [valid] ◄──── track appears ────── [empty-stopped-grace]
 *       │ destroy() called
 *       ▼
 *   [destroyed]
 *
 * @see src/shell/mpris/positionTracker.js
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { DBusPropertiesMethods } from "./dbus.js";
import {
  MPRIS_ROOT_IFACE_NAME,
  MPRIS_PLAYER_IFACE_NAME,
  MprisMetadataKeys,
  MprisPlayerMethods,
  MprisPlayerProperties,
  MprisPlayerSignals,
  MprisRootMethods,
  MprisRootProperties,
  normalizeLoopStatus,
  normalizeMprisString,
  normalizePlaybackStatus,
  MPRIS_PLAYER_PROPERTY_NAMES,
  MPRIS_ROOT_PROPERTY_NAMES,
} from "./protocol.js";
import { LoopStatus, PlaybackStatus } from "./protocol.js";
import {
  DBUS_CALL_TIMEOUT_MS,
  MPRIS_EMPTY_STOPPED_GRACE_MS,
  MPRIS_INIT_POLL_INTERVAL_MS,
  MPRIS_INIT_TIMEOUT_MS,
  MprisPlayerStateProperties,
  MprisPlayerValidity,
  matchesMprisOwnerSnapshot,
  resolveMprisOwnerTransition,
  resolveMprisPlayerValidity,
} from "./clientPolicy.js";
import { finiteNumberOr } from "../../shared/format.js";
import {
  createMprisMetadataRevision,
  createMprisTrack,
  metadataContainsTrack,
  normalizeMprisMetadata,
  normalizeMprisTrackId,
} from "./metadata.js";
import { createLogger } from "../../shared/logging/logger.js";
import { normalizePlaybackRateRange } from "./playbackRate.js";
import {
  normalizeSetPositionMicroseconds,
  resolvePlaybackPositionTrackContext,
} from "./position.js";
import {
  MprisOperationReasons,
  mprisOperationCancelled,
  mprisOperationFailed,
  mprisOperationSucceeded,
  mprisOperationUnsupported,
} from "./operationResult.js";
import {
  resolveOperationErrorName,
  isCancellationError,
} from "../platform/gioErrors.js";
import MprisPositionTracker from "./positionTracker.js";

Gio._promisify(Gio.DBusProxy.prototype, "call", "call_finish");

const logger = createLogger("MprisPlayer");
const LOOP_STATUS_ORDER = Object.freeze([
  LoopStatus.NONE,
  LoopStatus.PLAYLIST,
  LoopStatus.TRACK,
]);
const LOOP_STATUS_VALUES = new Set(LOOP_STATUS_ORDER);

/**
 * Models one MPRIS player endpoint owned by a session-bus service.
 */
export default class MprisPlayer {
  constructor(busName, mprisProxyFactory) {
    this.busName = busName;
    this.mprisProxyFactory = mprisProxyFactory;
    this.pinned = false;
    this.isInvalid = true;
    this.propertyChangeListeners = new Map();
    this.nextPropertyChangeListenerId = 1;
    this.proxySignalConnections = [];
    this.operationCancellable = new Gio.Cancellable();
    this.pollSourceId = null;
    this.metadataInvalidationSourceId = null;
    this.metadataRefreshPromise = null;
    this.metadataRefreshOwnerGeneration = null;
    this.hasPresentedTrackMetadata = false;
    this.hasCurrentTrackMetadata = false;
    // Normalize proxy variants once; UI getters are intentionally allocation-free.
    this.state = Object.create(null);
    this.metadataRevision = "";
    this.track = createMprisTrack();
    this.nameOwner = null;
    this.ownerGeneration = 0;
  }

  async init() {
    const [rootProxy, playerProxy, propertiesProxy] = await Promise.all([
      this.mprisProxyFactory.createRootProxy(
        this.busName,
        this.operationCancellable,
      ),
      this.mprisProxyFactory.createPlayerProxy(
        this.busName,
        this.operationCancellable,
      ),
      this.mprisProxyFactory.createPropertiesProxy(
        this.busName,
        this.operationCancellable,
      ),
    ]);

    if (this.isDestroyed) return false;

    this.rootProxy = rootProxy;
    this.playerProxy = playerProxy;
    this.propertiesProxy = propertiesProxy;
    this.adoptCurrentNameOwner(undefined, { refreshState: false });
    this.hydrateState(rootProxy, MPRIS_ROOT_PROPERTY_NAMES);
    this.hydrateState(playerProxy, MPRIS_PLAYER_PROPERTY_NAMES);
    this.positionTracker = new MprisPositionTracker(
      propertiesProxy,
      this.operationCancellable,
    );
    this.positionTracker.updateTrackContext(
      resolvePlaybackPositionTrackContext(this.metadata),
      { refresh: false },
    );

    this.connectProxySignal(
      rootProxy,
      "g-properties-changed",
      (proxy, changed, invalidated) => {
        this.handlePropertiesChangedSafely(
          MPRIS_ROOT_IFACE_NAME,
          proxy,
          changed,
          invalidated,
        );
      },
    );
    this.connectProxySignal(
      playerProxy,
      "g-properties-changed",
      (proxy, changed, invalidated) => {
        this.handlePropertiesChangedSafely(
          MPRIS_PLAYER_IFACE_NAME,
          proxy,
          changed,
          invalidated,
        );
      },
    );

    const seekedSignalId = playerProxy.connectSignal(
      MprisPlayerSignals.SEEKED,
      (_proxy, _sender, [positionMicroseconds]) => {
        this.positionTracker.handleSeeked(positionMicroseconds);
      },
    );
    this.proxySignalConnections.push({
      proxy: playerProxy,
      signalId: seekedSignalId,
      isDbusSignal: true,
    });

    this.positionTracker.updatePlaybackState(this.playbackStatus, this.rate);
    this.reconcileValidity();
    this.pollForInitialMetadata();
    return true;
  }

  hydrateState(proxy, properties) {
    for (const property of properties) {
      const value = this.readCachedProperty(proxy, property);
      if (value !== undefined) this.storeProperty(property, value);
    }
  }

  resetStateForOwnerChange() {
    const identity = this.state[MprisRootProperties.IDENTITY];
    const desktopEntry = this.state[MprisRootProperties.DESKTOP_ENTRY];
    const metadata = this.metadata;
    const hasStableMetadata = metadataContainsTrack(metadata);

    this.cancelMetadataInvalidation();
    this.state = Object.create(null);
    if (identity !== undefined)
      this.state[MprisRootProperties.IDENTITY] = identity;
    if (desktopEntry !== undefined)
      this.state[MprisRootProperties.DESKTOP_ENTRY] = desktopEntry;
    if (hasStableMetadata)
      this.state[MprisPlayerProperties.METADATA] = metadata;

    this.metadataRevision = hasStableMetadata
      ? createMprisMetadataRevision(metadata)
      : "";
    this.track = hasStableMetadata
      ? createMprisTrack(metadata)
      : createMprisTrack();
    this.hasCurrentTrackMetadata = false;
    this.hasPresentedTrackMetadata ||= hasStableMetadata;
    this.positionTracker?.resetForOwnerChange();
  }

  emitHydratedState() {
    for (const property of [
      ...MPRIS_ROOT_PROPERTY_NAMES,
      ...MPRIS_PLAYER_PROPERTY_NAMES,
    ])
      this.emitPropertyChanged(property, this.state[property]);
  }

  connectProxySignal(proxy, signal, callback) {
    const signalId = proxy.connect(signal, callback);
    this.proxySignalConnections.push({ proxy, signalId, isDbusSignal: false });
  }

  handlePropertiesChangedSafely(
    interfaceName,
    proxy,
    changedVariant,
    invalidatedProperties,
  ) {
    try {
      this.handlePropertiesChanged(
        interfaceName,
        proxy,
        changedVariant,
        invalidatedProperties,
      );
    } catch (error) {
      // A malformed third-party signal must not escape into the Shell
      // event loop or prevent later valid property updates.
      logger.warnOnce(
        `${this.busName}:${interfaceName}:malformed-update`,
        "Ignored malformed MPRIS property update",
        this.busName,
        interfaceName,
        error,
      );
    }
  }

  handlePropertiesChanged(
    interfaceName,
    proxy,
    changedVariant,
    invalidatedProperties = [],
  ) {
    const changed = changedVariant.recursiveUnpack();
    const invalidated = new Set(invalidatedProperties ?? []);

    for (const [property, value] of Object.entries(changed)) {
      if (
        interfaceName === MPRIS_PLAYER_IFACE_NAME &&
        property === MprisPlayerProperties.METADATA
      ) {
        this.applyMetadataUpdate(value);
        continue;
      }

      const normalized = this.storeProperty(property, value);
      this.emitPropertyChanged(property, normalized);
    }
    for (const property of invalidated) {
      // Some browser MPRIS implementations invalidate Metadata briefly
      // between adjacent media sessions. Keep the last stable value and
      // request the property explicitly instead of publishing an empty
      // cache entry to the UI.
      if (
        interfaceName === MPRIS_PLAYER_IFACE_NAME &&
        property === MprisPlayerProperties.METADATA
      ) {
        this.refreshMetadata().catch((error) => {
          if (!isCancellationError(error))
            logger.debugOnce(
              `${this.busName}:metadata-invalidated`,
              "Invalidated metadata refresh failed",
              error,
            );
        });
        continue;
      }

      const value = this.readCachedProperty(proxy, property);
      const normalized = this.storeProperty(property, value);
      this.emitPropertyChanged(property, normalized);
    }

    const hasChanged = (property) =>
      property in changed || invalidated.has(property);
    if (
      interfaceName === MPRIS_ROOT_IFACE_NAME &&
      (hasChanged(MprisRootProperties.IDENTITY) ||
        hasChanged(MprisRootProperties.DESKTOP_ENTRY))
    )
      this.reconcileValidity();

    if (interfaceName !== MPRIS_PLAYER_IFACE_NAME) return;

    if (
      hasChanged(MprisPlayerProperties.PLAYBACK_STATUS) ||
      hasChanged(MprisPlayerProperties.RATE)
    )
      this.positionTracker.updatePlaybackState(this.playbackStatus, this.rate);
    if (hasChanged(MprisPlayerProperties.PLAYBACK_STATUS))
      this.reconcileValidity();
  }

  pollForInitialMetadata() {
    if (this.hasCurrentTrackMetadata || this.pollSourceId !== null) return;

    // Initialization polling:
    // Some MPRIS players export their bus name before proxy properties are
    // populated. Poll at a bounded interval until metadata appears or the
    // timeout expires instead of trusting the initial D-Bus cache.
    let remaining = Math.ceil(
      MPRIS_INIT_TIMEOUT_MS / MPRIS_INIT_POLL_INTERVAL_MS,
    );
    this.pollSourceId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      MPRIS_INIT_POLL_INTERVAL_MS,
      () => {
        if (
          this.isDestroyed ||
          this.hasCurrentTrackMetadata ||
          --remaining < 0
        ) {
          this.pollSourceId = null;
          return GLib.SOURCE_REMOVE;
        }

        this.refreshMetadata().catch((error) => {
          if (!isCancellationError(error))
            logger.debugOnce(
              `${this.busName}:metadata-poll`,
              "Metadata poll failed",
              this.busName,
              error,
            );
        });
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  refreshMetadata() {
    if (this.isDestroyed || !this.propertiesProxy || !this.playerProxy)
      return Promise.resolve(false);

    const operationOwner = this.readCurrentNameOwner(this.propertiesProxy);
    if (!operationOwner) return Promise.resolve(false);
    this.adoptCurrentNameOwner(operationOwner);
    const operationOwnerGeneration = this.ownerGeneration;
    if (
      this.metadataRefreshPromise &&
      this.metadataRefreshOwnerGeneration === operationOwnerGeneration
    )
      return this.metadataRefreshPromise;

    const promise = this.readMetadata(
      operationOwner,
      operationOwnerGeneration,
    ).finally(() => {
      if (this.metadataRefreshPromise === promise) {
        this.metadataRefreshPromise = null;
        this.metadataRefreshOwnerGeneration = null;
      }
    });
    this.metadataRefreshPromise = promise;
    this.metadataRefreshOwnerGeneration = operationOwnerGeneration;
    return promise;
  }

  async readMetadata(operationOwner, operationOwnerGeneration) {
    if (this.isDestroyed || !this.propertiesProxy || !this.playerProxy)
      return false;
    const result = await this.propertiesProxy.call(
      DBusPropertiesMethods.GET,
      new GLib.Variant("(ss)", [
        MPRIS_PLAYER_IFACE_NAME,
        MprisPlayerProperties.METADATA,
      ]),
      Gio.DBusCallFlags.NONE,
      DBUS_CALL_TIMEOUT_MS,
      this.operationCancellable,
    );
    if (this.isDestroyed || !this.playerProxy) return false;

    const currentOwner = this.readCurrentNameOwner(this.propertiesProxy);
    if (
      !matchesMprisOwnerSnapshot(
        operationOwner,
        operationOwnerGeneration,
        currentOwner,
        this.ownerGeneration,
      )
    ) {
      if (currentOwner) this.adoptCurrentNameOwner(currentOwner);
      return false;
    }

    const variant = result.get_child_value(0).get_variant();
    this.playerProxy.set_cached_property(
      MprisPlayerProperties.METADATA,
      variant,
    );
    this.applyMetadataUpdate(variant);
    return true;
  }

  applyMetadataUpdate(metadataValue) {
    const metadata = normalizeMprisMetadata(metadataValue);
    const hasTrackMetadata = metadataContainsTrack(metadata);
    this.hasCurrentTrackMetadata = hasTrackMetadata;

    // Once a real track has been shown, do not replace it with a transient
    // empty browser payload. The endpoint validity logic below decides
    // whether the empty state is temporary or the session has really ended.
    if (!hasTrackMetadata && this.hasPresentedTrackMetadata) {
      this.reconcileValidity();
      return false;
    }

    const revision = createMprisMetadataRevision(metadata);
    if (revision === this.metadataRevision) {
      this.reconcileValidity();
      return false;
    }

    this.storeNormalizedMetadata(metadata, revision);
    this.positionTracker?.updateTrackContext(
      resolvePlaybackPositionTrackContext(metadata),
    );
    this.emitPropertyChanged(MprisPlayerProperties.METADATA, metadata);
    this.reconcileValidity();
    return true;
  }

  reconcileValidity() {
    const hasIdentity = Boolean(this.identity || this.desktopEntry);
    const hasTrackMetadata = this.hasCurrentTrackMetadata;
    const validity = resolveMprisPlayerValidity({
      hasIdentity,
      hasTrackMetadata,
      hasPresentedTrackMetadata: this.hasPresentedTrackMetadata,
      playbackStatus: this.playbackStatus,
    });

    if (validity === MprisPlayerValidity.INVALID) {
      this.cancelMetadataInvalidation();
      this.setInvalid(true);
      return;
    }

    if (validity === MprisPlayerValidity.VALID) {
      if (hasTrackMetadata) this.hasPresentedTrackMetadata = true;
      this.cancelMetadataInvalidation();
      this.setInvalid(false);
      return;
    }

    // Bound the final invalidation window. Duplicate empty/STOPPED signals
    // must not restart the timer indefinitely; real metadata or a non-stopped
    // playback state cancels it above.
    if (this.metadataInvalidationSourceId !== null) return;
    this.metadataInvalidationSourceId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      MPRIS_EMPTY_STOPPED_GRACE_MS,
      () => {
        this.metadataInvalidationSourceId = null;
        if (
          !this.isDestroyed &&
          !this.hasCurrentTrackMetadata &&
          this.playbackStatus === PlaybackStatus.STOPPED
        )
          this.setInvalid(true);
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  cancelMetadataInvalidation() {
    if (this.metadataInvalidationSourceId === null) return;
    GLib.Source.remove(this.metadataInvalidationSourceId);
    this.metadataInvalidationSourceId = null;
  }

  setInvalid(isInvalid) {
    if (isInvalid === this.isInvalid) return;
    this.isInvalid = isInvalid;
    this.emitPropertyChanged(MprisPlayerStateProperties.IS_INVALID, isInvalid);
  }

  storeNormalizedMetadata(metadata, revision = null) {
    this.state[MprisPlayerProperties.METADATA] = metadata;
    this.track = createMprisTrack(metadata);
    this.metadataRevision = revision ?? createMprisMetadataRevision(metadata);
    this.hasCurrentTrackMetadata = metadataContainsTrack(metadata);
    return metadata;
  }

  readCachedProperty(proxy, property, fallback = undefined) {
    try {
      const value = proxy?.get_cached_property(property);
      return value?.recursiveUnpack?.() ?? fallback;
    } catch (error) {
      logger.debugOnce(
        `${this.busName}:cached:${property}`,
        "MPRIS cached property could not be read; using its default",
        property,
        error,
      );
      return fallback;
    }
  }

  storeProperty(property, value) {
    if (property === MprisPlayerProperties.METADATA)
      return this.storeNormalizedMetadata(normalizeMprisMetadata(value));

    this.state[property] = value;
    return value;
  }

  hasPlayerProperty(property) {
    return Boolean(
      this.state &&
      Object.hasOwn(this.state, property) &&
      this.state[property] !== undefined,
    );
  }

  readCurrentNameOwner(preferredProxy = null) {
    for (const proxy of [
      preferredProxy,
      this.rootProxy,
      this.playerProxy,
      this.propertiesProxy,
    ]) {
      if (!proxy) continue;
      const nameOwner = proxy.get_name_owner();
      if (nameOwner) return nameOwner;
    }
    return null;
  }

  adoptCurrentNameOwner(
    nameOwner = this.readCurrentNameOwner(),
    { refreshState = true } = {},
  ) {
    const transition = resolveMprisOwnerTransition(this.nameOwner, nameOwner);
    if (this.isDestroyed || !transition.hasOwner) return false;
    if (!transition.changed) return true;

    this.nameOwner = transition.owner;
    this.ownerGeneration++;
    if (refreshState) {
      this.resetStateForOwnerChange();
      if (this.rootProxy)
        this.hydrateState(this.rootProxy, MPRIS_ROOT_PROPERTY_NAMES);
      if (this.playerProxy)
        this.hydrateState(this.playerProxy, MPRIS_PLAYER_PROPERTY_NAMES);
      this.positionTracker?.updateTrackContext(
        resolvePlaybackPositionTrackContext(this.metadata),
        { refresh: false },
      );
      this.positionTracker?.updatePlaybackState(this.playbackStatus, this.rate);
      this.emitHydratedState();
      this.reconcileValidity();
      this.pollForInitialMetadata();
    }
    return true;
  }

  pin() {
    if (this.pinned) return;
    this.pinned = true;
    this.emitPropertyChanged(MprisPlayerStateProperties.IS_PINNED, true);
  }

  unpin() {
    if (!this.pinned) return;
    this.pinned = false;
    this.emitPropertyChanged(MprisPlayerStateProperties.IS_PINNED, false);
  }

  get isDestroyed() {
    return this.operationCancellable === null;
  }

  get isPinned() {
    return this.pinned;
  }

  get playbackStatus() {
    return normalizePlaybackStatus(
      this.state[MprisPlayerProperties.PLAYBACK_STATUS],
    );
  }
  get loopStatus() {
    return normalizeLoopStatus(this.state[MprisPlayerProperties.LOOP_STATUS]);
  }
  get rate() {
    return finiteNumberOr(this.state[MprisPlayerProperties.RATE], 1, {
      minimum: Number.EPSILON,
    });
  }
  get shuffle() {
    return Boolean(this.state[MprisPlayerProperties.SHUFFLE]);
  }
  get metadata() {
    return this.state[MprisPlayerProperties.METADATA] ?? {};
  }
  get volume() {
    return finiteNumberOr(this.state[MprisPlayerProperties.VOLUME], 0, {
      minimum: 0,
    });
  }
  get positionMicroseconds() {
    return (
      this.positionTracker?.readPositionMicroseconds() ?? Promise.resolve(0)
    );
  }
  get estimatedPositionMicroseconds() {
    return this.positionTracker?.resolveEstimatedPositionMicroseconds() ?? 0;
  }
  get minimumRate() {
    return finiteNumberOr(this.state[MprisPlayerProperties.MINIMUM_RATE], 1);
  }
  get maximumRate() {
    return finiteNumberOr(this.state[MprisPlayerProperties.MAXIMUM_RATE], 1);
  }
  get canGoNext() {
    return Boolean(this.state[MprisPlayerProperties.CAN_GO_NEXT]);
  }
  get canGoPrevious() {
    return Boolean(this.state[MprisPlayerProperties.CAN_GO_PREVIOUS]);
  }
  get canPlay() {
    return Boolean(this.state[MprisPlayerProperties.CAN_PLAY]);
  }
  get canPause() {
    return Boolean(this.state[MprisPlayerProperties.CAN_PAUSE]);
  }
  get canSeek() {
    return Boolean(this.state[MprisPlayerProperties.CAN_SEEK]);
  }
  get canControl() {
    return Boolean(this.state[MprisPlayerProperties.CAN_CONTROL]);
  }
  get trackId() {
    // SetPosition is a protocol operation, so source its TrackId directly from
    // the current normalized MPRIS Metadata rather than the semantic Track DTO.
    return normalizeMprisTrackId(this.metadata[MprisMetadataKeys.TRACK_ID]);
  }
  get canSetPosition() {
    return this.canControl && this.canSeek && this.trackId !== null;
  }
  get canSetLoopStatus() {
    return this.hasPlayerProperty(MprisPlayerProperties.LOOP_STATUS);
  }
  get canSetPlaybackRate() {
    return (
      this.hasPlayerProperty(MprisPlayerProperties.RATE) &&
      this.hasPlayerProperty(MprisPlayerProperties.MINIMUM_RATE) &&
      this.hasPlayerProperty(MprisPlayerProperties.MAXIMUM_RATE)
    );
  }
  get canSetShuffle() {
    return this.hasPlayerProperty(MprisPlayerProperties.SHUFFLE);
  }
  get canQuit() {
    return Boolean(this.state[MprisRootProperties.CAN_QUIT]);
  }
  get hasBusOwner() {
    return Boolean(this.rootProxy?.get_name_owner());
  }
  get canRaise() {
    return Boolean(this.state[MprisRootProperties.CAN_RAISE]);
  }
  get desktopEntry() {
    return normalizeMprisString(this.state[MprisRootProperties.DESKTOP_ENTRY]);
  }
  get identity() {
    return normalizeMprisString(this.state[MprisRootProperties.IDENTITY]);
  }

  set loopStatus(value) {
    void this.setLoopStatus(value);
  }
  set rate(value) {
    void this.setPlaybackRate(value);
  }
  set shuffle(value) {
    void this.setShuffle(value);
  }
  set volume(value) {
    void this.setVolume(value);
  }

  #guardPlayerOperation(isSupported = true) {
    if (this.isDestroyed)
      return mprisOperationCancelled(MprisOperationReasons.DESTROYED);
    if (!this.canControl || !isSupported)
      return mprisOperationUnsupported(MprisOperationReasons.CAPABILITY);
    return null;
  }

  #guardRootOperation(isSupported = true) {
    if (this.isDestroyed)
      return mprisOperationCancelled(MprisOperationReasons.DESTROYED);
    if (!isSupported)
      return mprisOperationUnsupported(MprisOperationReasons.CAPABILITY);
    return null;
  }

  /**
   * Calls one D-Bus method and returns a lifecycle-safe operation result.
   *
   * No command is retried: a playback call may already have reached the remote
   * endpoint even when the reply is lost. Cancellation during destroy is an
   * expected local outcome and is never logged as a warning.
   *
   * @param {Gio.DBusProxy|null} proxy - Proxy that owns the method call.
   * @param {string} method - D-Bus method name.
   * @param {GLib.Variant|null} parameters - Method parameters, or null.
   * @param {string} logKey - Stable warning-deduplication key.
   * @param {string} logMessage - Human-readable warning prefix.
   * @returns {Promise<object>} Explicit MPRIS operation result.
   */
  async #callProxy(proxy, method, parameters, logKey, logMessage) {
    if (this.isDestroyed)
      return mprisOperationCancelled(MprisOperationReasons.DESTROYED);
    if (!proxy) {
      logger.warnOnce(logKey, logMessage, this.busName, "proxy unavailable");
      return mprisOperationFailed(MprisOperationReasons.MISSING_PROXY);
    }

    try {
      const operationOwner = this.readCurrentNameOwner(proxy);
      if (!operationOwner) {
        logger.warnOnce(logKey, logMessage, this.busName, "no D-Bus owner");
        return mprisOperationFailed(MprisOperationReasons.NO_OWNER);
      }
      this.adoptCurrentNameOwner(operationOwner);
      const operationOwnerGeneration = this.ownerGeneration;

      await proxy.call(
        method,
        parameters,
        Gio.DBusCallFlags.NONE,
        DBUS_CALL_TIMEOUT_MS,
        this.operationCancellable,
      );
      if (this.isDestroyed)
        return mprisOperationCancelled(MprisOperationReasons.DESTROYED);

      const currentOwner = this.readCurrentNameOwner(proxy);
      if (
        !matchesMprisOwnerSnapshot(
          operationOwner,
          operationOwnerGeneration,
          currentOwner,
          this.ownerGeneration,
        )
      ) {
        if (currentOwner) this.adoptCurrentNameOwner(currentOwner);
        return mprisOperationCancelled(MprisOperationReasons.OWNER_CHANGED);
      }
      return mprisOperationSucceeded();
    } catch (error) {
      if (isCancellationError(error))
        return mprisOperationCancelled(MprisOperationReasons.CANCELLED);

      const errorName = resolveOperationErrorName(error);
      logger.warnOnce(logKey, logMessage, this.busName, error);
      return mprisOperationFailed(MprisOperationReasons.DBUS_ERROR, errorName);
    }
  }

  async #setProperty(property, value) {
    if (typeof property !== "string" || !value)
      return mprisOperationUnsupported(MprisOperationReasons.INVALID_ARGUMENT);

    return this.#callProxy(
      this.propertiesProxy,
      DBusPropertiesMethods.SET,
      new GLib.Variant("(ssv)", [MPRIS_PLAYER_IFACE_NAME, property, value]),
      `set-property:${this.busName}:${property}`,
      `Failed to set MPRIS property ${property}`,
    );
  }

  async #callPlayer(method, parameters = null) {
    return this.#callProxy(
      this.playerProxy,
      method,
      parameters,
      `player-call:${this.busName}:${method}`,
      `MPRIS ${method} failed`,
    );
  }

  async #callRoot(method) {
    return this.#callProxy(
      this.rootProxy,
      method,
      null,
      `root-call:${this.busName}:${method}`,
      `MPRIS ${method} failed`,
    );
  }

  async next() {
    const guardResult = this.#guardPlayerOperation(this.canGoNext);
    if (guardResult) return guardResult;
    return this.#callPlayer(MprisPlayerMethods.NEXT);
  }

  async previous() {
    const guardResult = this.#guardPlayerOperation(this.canGoPrevious);
    if (guardResult) return guardResult;
    return this.#callPlayer(MprisPlayerMethods.PREVIOUS);
  }

  async pause() {
    const guardResult = this.#guardPlayerOperation(this.canPause);
    if (guardResult) return guardResult;
    return this.#callPlayer(MprisPlayerMethods.PAUSE);
  }

  async playPause() {
    const guardResult = this.#guardPlayerOperation(this.canPause);
    if (guardResult) return guardResult;
    return this.#callPlayer(MprisPlayerMethods.PLAY_PAUSE);
  }

  async stop() {
    const guardResult = this.#guardPlayerOperation();
    if (guardResult) return guardResult;
    return this.#callPlayer(MprisPlayerMethods.STOP);
  }

  async play() {
    const guardResult = this.#guardPlayerOperation(this.canPlay);
    if (guardResult) return guardResult;
    return this.#callPlayer(MprisPlayerMethods.PLAY);
  }

  async seek(offsetMicroseconds) {
    const guardResult = this.#guardPlayerOperation(this.canSeek);
    if (guardResult) return guardResult;
    if (!Number.isFinite(offsetMicroseconds))
      return mprisOperationUnsupported(MprisOperationReasons.INVALID_ARGUMENT);

    const offset = Math.trunc(offsetMicroseconds);
    if (offset === 0)
      return mprisOperationSucceeded(MprisOperationReasons.ALREADY_CURRENT);
    return this.#callPlayer(
      MprisPlayerMethods.SEEK,
      new GLib.Variant("(x)", [offset]),
    );
  }

  async setPosition(trackId, positionMicroseconds) {
    const currentTrackId = this.trackId;
    const guardResult = this.#guardPlayerOperation(
      this.canSeek && currentTrackId !== null,
    );
    if (guardResult) return guardResult;

    const normalizedTrackId = normalizeMprisTrackId(trackId);
    const position = normalizeSetPositionMicroseconds(
      positionMicroseconds,
      this.metadata[MprisMetadataKeys.LENGTH],
    );
    if (normalizedTrackId !== currentTrackId || position === null)
      return mprisOperationUnsupported(MprisOperationReasons.INVALID_ARGUMENT);

    return this.#callPlayer(
      MprisPlayerMethods.SET_POSITION,
      new GLib.Variant("(ox)", [normalizedTrackId, position]),
    );
  }

  async setPlaybackRate(value) {
    const guardResult = this.#guardPlayerOperation(this.canSetPlaybackRate);
    if (guardResult) return guardResult;
    if (!Number.isFinite(value) || value <= 0)
      return mprisOperationUnsupported(MprisOperationReasons.INVALID_ARGUMENT);

    const { minimumRate, maximumRate } = normalizePlaybackRateRange(
      this.minimumRate,
      this.maximumRate,
    );
    const rate = Math.min(maximumRate, Math.max(minimumRate, value));
    if (rate <= 0)
      return mprisOperationUnsupported(MprisOperationReasons.INVALID_ARGUMENT);
    if (rate === this.rate)
      return mprisOperationSucceeded(MprisOperationReasons.ALREADY_CURRENT);
    return this.#setProperty(
      MprisPlayerProperties.RATE,
      new GLib.Variant("d", rate),
    );
  }

  async setLoopStatus(value) {
    const guardResult = this.#guardPlayerOperation(this.canSetLoopStatus);
    if (guardResult) return guardResult;
    if (!LOOP_STATUS_VALUES.has(value))
      return mprisOperationUnsupported(MprisOperationReasons.INVALID_ARGUMENT);
    if (value === this.loopStatus)
      return mprisOperationSucceeded(MprisOperationReasons.ALREADY_CURRENT);
    return this.#setProperty(
      MprisPlayerProperties.LOOP_STATUS,
      new GLib.Variant("s", value),
    );
  }

  async setShuffle(value) {
    const guardResult = this.#guardPlayerOperation(this.canSetShuffle);
    if (guardResult) return guardResult;
    if (typeof value !== "boolean")
      return mprisOperationUnsupported(MprisOperationReasons.INVALID_ARGUMENT);
    if (value === this.shuffle)
      return mprisOperationSucceeded(MprisOperationReasons.ALREADY_CURRENT);
    return this.#setProperty(
      MprisPlayerProperties.SHUFFLE,
      new GLib.Variant("b", value),
    );
  }

  async setVolume(value) {
    const guardResult = this.#guardPlayerOperation();
    if (guardResult) return guardResult;
    if (!Number.isFinite(value))
      return mprisOperationUnsupported(MprisOperationReasons.INVALID_ARGUMENT);

    const volume = Math.max(0, value);
    if (volume === this.volume)
      return mprisOperationSucceeded(MprisOperationReasons.ALREADY_CURRENT);
    return this.#setProperty(
      MprisPlayerProperties.VOLUME,
      new GLib.Variant("d", volume),
    );
  }

  async raise() {
    const guardResult = this.#guardRootOperation(this.canRaise);
    if (guardResult) return guardResult;
    return this.#callRoot(MprisRootMethods.RAISE);
  }

  async quit() {
    const guardResult = this.#guardRootOperation(this.canQuit);
    if (guardResult) return guardResult;
    return this.#callRoot(MprisRootMethods.QUIT);
  }

  async toggleLoop() {
    const guardResult = this.#guardPlayerOperation(this.canSetLoopStatus);
    if (guardResult) return guardResult;

    const current = LOOP_STATUS_ORDER.indexOf(this.loopStatus);
    return this.setLoopStatus(
      LOOP_STATUS_ORDER[
        (current + 1 + LOOP_STATUS_ORDER.length) % LOOP_STATUS_ORDER.length
      ],
    );
  }

  async toggleShuffle() {
    const guardResult = this.#guardPlayerOperation(this.canSetShuffle);
    if (guardResult) return guardResult;
    return this.setShuffle(!this.shuffle);
  }

  onPositionChanged(callback) {
    return this.positionTracker?.onPositionChanged(callback) ?? (() => {});
  }

  onPropertyChanged(property, callback) {
    if (this.isDestroyed) return 0;
    const listenerId = this.nextPropertyChangeListenerId++;
    let propertyChangeListeners = this.propertyChangeListeners.get(property);
    if (!propertyChangeListeners) {
      propertyChangeListeners = new Map();
      this.propertyChangeListeners.set(property, propertyChangeListeners);
    }
    propertyChangeListeners.set(listenerId, callback);
    return listenerId;
  }

  removePropertyChangeListener(property, listenerId) {
    const propertyChangeListeners = this.propertyChangeListeners.get(property);
    propertyChangeListeners?.delete(listenerId);
    if (propertyChangeListeners?.size === 0)
      this.propertyChangeListeners.delete(property);
  }

  emitPropertyChanged(property, value) {
    const propertyChangeListeners = this.propertyChangeListeners.get(property);
    if (!propertyChangeListeners) return;

    for (const callback of [...propertyChangeListeners.values()]) {
      try {
        callback(value);
      } catch (error) {
        logger.errorOnce(
          `property-listener:${this.busName}:${property}`,
          `Listener for ${property} failed`,
          this.busName,
          error,
        );
      }
    }
  }

  destroy() {
    const operationCancellable = this.operationCancellable;
    if (!operationCancellable) return;

    this.operationCancellable = null;
    operationCancellable.cancel();

    if (this.pollSourceId !== null) {
      GLib.Source.remove(this.pollSourceId);
      this.pollSourceId = null;
    }
    this.cancelMetadataInvalidation();

    for (const { proxy, signalId, isDbusSignal } of this
      .proxySignalConnections) {
      if (isDbusSignal) proxy.disconnectSignal(signalId);
      else proxy.disconnect(signalId);
    }
    this.proxySignalConnections.length = 0;
    this.positionTracker?.destroy();
    this.propertyChangeListeners.clear();
    this.state = null;
    this.track = null;
    this.metadataRefreshPromise = null;
    this.hasCurrentTrackMetadata = false;
    this.rootProxy = null;
    this.playerProxy = null;
    this.nameOwner = null;
    this.ownerGeneration++;
    this.propertiesProxy = null;
    this.positionTracker = null;
    this.mprisProxyFactory = null;
  }
}
