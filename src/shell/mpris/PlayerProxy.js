/**
 * @file PlayerProxy.js
 * @module shell.mpris.PlayerProxy
 *
 * Normalizes one MPRIS player into stable state, commands, and signals.
 *
 * Each proxy owns the DBus proxies, cached player properties, metadata
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
 * @see src/shell/mpris/PositionTracker.js
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import {
  MPRIS_IFACE_NAME,
  MPRIS_PLAYER_IFACE_NAME,
  PLAYER_PROPERTIES,
  ROOT_PROPERTIES,
} from "../../shared/constants/dbus.js";
import { MediaAppValidity } from "../../shared/enums/app.js";
import { LoopStatus, PlaybackStatus } from "../../shared/enums/playback.js";
import {
  DBUS_CALL_TIMEOUT_MS,
  MEDIA_APP_EMPTY_STOPPED_GRACE_MS,
  MPRIS_INIT_POLL_INTERVAL_MS,
  MPRIS_INIT_TIMEOUT_MS,
} from "../../shared/constants/timing.js";
import { finiteNumberOr } from "../../shared/utils/format.js";
import { createLogger } from "../../shared/utils/log.js";
import {
  metadataContainsTrack,
  normalizeLoopStatus,
  normalizePlaybackStatus,
  resolveMediaAppValidity,
} from "../../shared/utils/mpris.js";
import { isCancellationError } from "../utils/errors.js";
import PositionTracker from "./PositionTracker.js";

Gio._promisify(Gio.DBusProxy.prototype, "call", "call_finish");

const logger = createLogger("PlayerProxy");

function getMetadataRevision(metadata) {
  const artist = Array.isArray(metadata?.["xesam:artist"])
    ? metadata["xesam:artist"].join("\u0000")
    : metadata?.["xesam:artist"];
  return [
    metadata?.["mpris:trackid"],
    metadata?.["mpris:length"],
    metadata?.["mpris:artUrl"],
    metadata?.["xesam:url"],
    metadata?.["xesam:title"],
    artist,
    metadata?.["xesam:album"],
    metadata?.["xesam:discNumber"],
    metadata?.["xesam:trackNumber"],
  ]
    .map((value) => String(value ?? ""))
    .join("\u0001");
}

/**
 * Normalizes one MPRIS player into stable state, commands, and signals.
 */
export default class PlayerProxy {
  constructor(busName, mprisProxyFactory) {
    this.busName = busName;
    this.mprisProxyFactory = mprisProxyFactory;
    this.appPinned = false;
    this.isMediaAppInvalid = true;
    this.isDestroyed = false;
    this.propertyChangeListeners = new Map();
    this.nextPropertyChangeListenerId = 1;
    this.proxySignalConnections = [];
    this.operationCancellable = new Gio.Cancellable();
    this.pollSourceId = null;
    this.metadataInvalidationSourceId = null;
    this.metadataRefreshPromise = null;
    this.hasPresentedTrackMetadata = false;
    this.hasCurrentTrackMetadata = false;
    // Normalize proxy variants once; UI getters are intentionally allocation-free.
    this.state = Object.create(null);
    this.metadataRevision = "";
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
    this.hydrateState(rootProxy, ROOT_PROPERTIES);
    this.hydrateState(playerProxy, PLAYER_PROPERTIES);
    this.positionTracker = new PositionTracker(
      propertiesProxy,
      this.operationCancellable,
    );

    this.connectProxySignal(
      rootProxy,
      "g-properties-changed",
      (proxy, changed, invalidated) => {
        this.handlePropertiesChangedSafely(
          MPRIS_IFACE_NAME,
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
      "Seeked",
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
    this.validateMediaApp();
    this.pollForInitialMetadata();
    return true;
  }

  hydrateState(proxy, properties) {
    for (const property of properties) {
      const value = this.readCachedProperty(proxy, property);
      if (value !== undefined) this.storeProperty(property, value);
    }
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

    let acceptedMetadataChange = false;
    for (const [property, value] of Object.entries(changed)) {
      if (
        interfaceName === MPRIS_PLAYER_IFACE_NAME &&
        property === "Metadata"
      ) {
        acceptedMetadataChange =
          this.applyMetadataUpdate(value) || acceptedMetadataChange;
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
        property === "Metadata"
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
      interfaceName === MPRIS_IFACE_NAME &&
      (hasChanged("Identity") || hasChanged("DesktopEntry"))
    )
      this.validateMediaApp();

    if (interfaceName !== MPRIS_PLAYER_IFACE_NAME) return;

    if (acceptedMetadataChange) this.positionTracker.resetForTrackChange();
    if (hasChanged("PlaybackStatus") || hasChanged("Rate"))
      this.positionTracker.updatePlaybackState(this.playbackStatus, this.rate);
    if (hasChanged("PlaybackStatus")) this.validateMediaApp();
  }

  pollForInitialMetadata() {
    if (this.hasCurrentTrackMetadata || this.pollSourceId !== null) return;

    // Initialization polling:
    // Some MPRIS players export their bus name before proxy properties are
    // populated. Poll at a bounded interval until metadata appears or the
    // timeout expires instead of trusting the initial DBus cache.
    let pollCount = 0;
    let remaining = Math.ceil(
      MPRIS_INIT_TIMEOUT_MS / MPRIS_INIT_POLL_INTERVAL_MS,
    );
    logger.debug("MPRIS initialization polling started for", this.busName);
    this.pollSourceId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      MPRIS_INIT_POLL_INTERVAL_MS,
      () => {
        if (
          this.isDestroyed ||
          this.hasCurrentTrackMetadata ||
          --remaining < 0
        ) {
          if (this.hasCurrentTrackMetadata)
            logger.debug(
              `MPRIS proxy initialized after ${pollCount} polls for ${this.busName}`,
            );
          this.pollSourceId = null;
          return GLib.SOURCE_REMOVE;
        }

        pollCount++;
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
    if (this.metadataRefreshPromise) return this.metadataRefreshPromise;

    const promise = this.readMetadata().finally(() => {
      if (this.metadataRefreshPromise === promise)
        this.metadataRefreshPromise = null;
    });
    this.metadataRefreshPromise = promise;
    return promise;
  }

  async readMetadata() {
    if (this.isDestroyed || !this.propertiesProxy || !this.playerProxy)
      return false;
    const result = await this.propertiesProxy.call(
      "Get",
      new GLib.Variant("(ss)", [MPRIS_PLAYER_IFACE_NAME, "Metadata"]),
      Gio.DBusCallFlags.NONE,
      DBUS_CALL_TIMEOUT_MS,
      this.operationCancellable,
    );
    if (this.isDestroyed || !this.playerProxy) return false;

    const variant = result.get_child_value(0).get_variant();
    this.playerProxy.set_cached_property("Metadata", variant);
    const metadata = this.unpackMetadata(variant.recursiveUnpack());
    if (this.applyMetadataUpdate(metadata))
      this.positionTracker?.resetForTrackChange();
    return true;
  }

  applyMetadataUpdate(metadataValue) {
    const metadata = this.unpackMetadata(metadataValue);
    const hasTrackMetadata = metadataContainsTrack(metadata);
    this.hasCurrentTrackMetadata = hasTrackMetadata;

    // Once a real track has been shown, do not replace it with a transient
    // empty browser payload. The endpoint validity logic below decides
    // whether the empty state is temporary or the session has really ended.
    if (!hasTrackMetadata && this.hasPresentedTrackMetadata) {
      this.validateMediaApp();
      return false;
    }

    const revision = getMetadataRevision(metadata);
    if (revision === this.metadataRevision) {
      this.validateMediaApp();
      return false;
    }

    this.storeProperty("Metadata", metadata);
    this.emitPropertyChanged("Metadata", metadata);
    this.validateMediaApp();
    return true;
  }

  validateMediaApp() {
    const hasIdentity = Boolean(this.identity || this.desktopEntry);
    const hasTrackMetadata = this.hasCurrentTrackMetadata;
    const validity = resolveMediaAppValidity({
      hasIdentity,
      hasTrackMetadata,
      hasPresentedTrackMetadata: this.hasPresentedTrackMetadata,
      playbackStatus: this.playbackStatus,
    });

    if (validity === MediaAppValidity.INVALID) {
      this.cancelMetadataInvalidation();
      this.setMediaAppInvalid(true);
      return;
    }

    if (validity === MediaAppValidity.VALID) {
      if (hasTrackMetadata) this.hasPresentedTrackMetadata = true;
      this.cancelMetadataInvalidation();
      this.setMediaAppInvalid(false);
      return;
    }

    // Bound the final invalidation window. Duplicate empty/STOPPED signals
    // must not restart the timer indefinitely; real metadata or a non-stopped
    // playback state cancels it above.
    if (this.metadataInvalidationSourceId !== null) return;
    logger.debug("Empty-stopped grace period started for", this.busName);
    this.metadataInvalidationSourceId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      MEDIA_APP_EMPTY_STOPPED_GRACE_MS,
      () => {
        this.metadataInvalidationSourceId = null;
        if (
          !this.isDestroyed &&
          !this.hasCurrentTrackMetadata &&
          this.playbackStatus === PlaybackStatus.STOPPED
        )
          this.setMediaAppInvalid(true);
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  cancelMetadataInvalidation() {
    if (this.metadataInvalidationSourceId === null) return;
    GLib.Source.remove(this.metadataInvalidationSourceId);
    this.metadataInvalidationSourceId = null;
  }

  setMediaAppInvalid(isInvalid) {
    if (isInvalid === this.isMediaAppInvalid) return;
    if (this.isMediaAppInvalid && !isInvalid)
      logger.debug("First valid track received for", this.busName);
    this.isMediaAppInvalid = isInvalid;
    this.emitPropertyChanged("IsMediaAppInvalid", isInvalid);
  }

  unpackMetadata(metadata) {
    if (!metadata) return {};
    if (typeof metadata.recursiveUnpack === "function")
      return metadata.recursiveUnpack();
    if (typeof metadata !== "object" || Array.isArray(metadata)) return {};

    const unpacked = {};
    for (const [key, value] of Object.entries(metadata))
      unpacked[key] =
        value?.recursiveUnpack?.() ?? value?.deepUnpack?.() ?? value;
    return unpacked;
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
    const normalized =
      property === "Metadata" ? this.unpackMetadata(value) : value;
    this.state[property] = normalized;
    if (property === "Metadata") {
      this.metadataRevision = getMetadataRevision(normalized);
      this.hasCurrentTrackMetadata = metadataContainsTrack(normalized);
    }
    return normalized;
  }

  pinApp() {
    if (this.appPinned) return;
    this.appPinned = true;
    this.emitPropertyChanged("IsPinned", true);
  }

  unpinApp() {
    if (!this.appPinned) return;
    this.appPinned = false;
    this.emitPropertyChanged("IsPinned", false);
  }

  isAppPinned() {
    return this.appPinned;
  }

  get playbackStatus() {
    return normalizePlaybackStatus(this.state.PlaybackStatus);
  }
  get loopStatus() {
    return normalizeLoopStatus(this.state.LoopStatus);
  }
  get rate() {
    return finiteNumberOr(this.state.Rate, 1, { minimum: Number.EPSILON });
  }
  get shuffle() {
    return Boolean(this.state.Shuffle);
  }
  get metadata() {
    return this.state.Metadata ?? {};
  }
  get volume() {
    return finiteNumberOr(this.state.Volume, 0, { minimum: 0 });
  }
  get positionMicroseconds() {
    return (
      this.positionTracker?.getPositionMicroseconds() ?? Promise.resolve(0)
    );
  }
  get estimatedPositionMicroseconds() {
    return this.positionTracker?.getEstimatedPositionMicroseconds() ?? 0;
  }
  get minimumRate() {
    return finiteNumberOr(this.state.MinimumRate, 1, {
      minimum: Number.EPSILON,
    });
  }
  get maximumRate() {
    return finiteNumberOr(this.state.MaximumRate, 1, {
      minimum: Number.EPSILON,
    });
  }
  get canGoNext() {
    return Boolean(this.state.CanGoNext);
  }
  get canGoPrevious() {
    return Boolean(this.state.CanGoPrevious);
  }
  get canPlay() {
    return Boolean(this.state.CanPlay);
  }
  get canPause() {
    return Boolean(this.state.CanPause);
  }
  get canSeek() {
    return Boolean(this.state.CanSeek);
  }
  get canControl() {
    return Boolean(this.state.CanControl);
  }
  get canQuit() {
    return Boolean(this.state.CanQuit);
  }
  get hasBusOwner() {
    return Boolean(this.rootProxy?.get_name_owner?.());
  }
  get canRaise() {
    return Boolean(this.state.CanRaise);
  }
  get canSetFullscreen() {
    return Boolean(this.state.CanSetFullscreen);
  }
  get desktopEntry() {
    return String(this.state.DesktopEntry ?? "");
  }
  get hasTrackList() {
    return Boolean(this.state.HasTrackList);
  }
  get identity() {
    return String(this.state.Identity ?? "");
  }
  get supportedMimeTypes() {
    return this.state.SupportedMimeTypes ?? [];
  }
  get supportedUriSchemes() {
    return this.state.SupportedUriSchemes ?? [];
  }

  set loopStatus(value) {
    this.setProperty("LoopStatus", new GLib.Variant("s", value));
  }
  set rate(value) {
    if (!Number.isFinite(value)) return;
    const minimum = this.minimumRate;
    const maximum = Math.max(minimum, this.maximumRate);
    const rate = Math.min(maximum, Math.max(minimum, value));
    if (rate !== 0) this.setProperty("Rate", new GLib.Variant("d", rate));
  }
  set shuffle(value) {
    this.setProperty("Shuffle", new GLib.Variant("b", value));
  }
  set volume(value) {
    if (!Number.isFinite(value)) return;
    this.setProperty("Volume", new GLib.Variant("d", Math.max(0, value)));
  }
  set fullscreen(value) {
    if (this.canSetFullscreen)
      this.setRootProperty("Fullscreen", new GLib.Variant("b", value));
  }

  /**
   * Calls a D-Bus method on the given proxy, drops cancellation errors, and logs genuine failures.
   *
   * PlayerProxy uses this helper for both root and Player-interface calls so
   * disable-time cancellations stay silent while real MPRIS/D-Bus failures are
   * logged once per stable key. The helper also centralizes the call timeout and
   * operation cancellable used by all outbound proxy calls.
   *
   * @param {Gio.DBusProxy|null} proxy - Proxy that owns the method call.
   * @param {string} method - D-Bus method name.
   * @param {GLib.Variant|null} parameters - Method parameters, or null for no-args calls.
   * @param {string} logKey - Stable key for warning deduplication.
   * @param {string} logMessage - Human-readable warning prefix.
   * @returns {Promise<void>} Resolves after the call succeeds, is cancelled, or is logged.
   */
  async #callProxy(proxy, method, parameters, logKey, logMessage) {
    if (this.isDestroyed || !proxy) return;
    await proxy
      .call(
        method,
        parameters,
        Gio.DBusCallFlags.NONE,
        DBUS_CALL_TIMEOUT_MS,
        this.operationCancellable,
      )
      .catch((error) => {
        if (isCancellationError(error)) return;
        logger.warnOnce(logKey, logMessage, this.busName, error);
      });
  }

  async setProperty(property, value) {
    if (!this.canControl) return;
    await this.#callProxy(
      this.propertiesProxy,
      "Set",
      new GLib.Variant("(ssv)", [MPRIS_PLAYER_IFACE_NAME, property, value]),
      `set-property:${this.busName}:${property}`,
      `Failed to set MPRIS property ${property}`,
    );
  }

  async setRootProperty(property, value) {
    await this.#callProxy(
      this.propertiesProxy,
      "Set",
      new GLib.Variant("(ssv)", [MPRIS_IFACE_NAME, property, value]),
      `set-root-property:${this.busName}:${property}`,
      `Failed to set MPRIS root property ${property}`,
    );
  }

  async callPlayer(method, parameters = null) {
    if (!this.canControl) return;
    await this.#callProxy(
      this.playerProxy,
      method,
      parameters,
      `player-call:${this.busName}:${method}`,
      `MPRIS ${method} failed`,
    );
  }

  async callRoot(method) {
    await this.#callProxy(
      this.rootProxy,
      method,
      null,
      `root-call:${this.busName}:${method}`,
      `MPRIS ${method} failed`,
    );
  }

  next() {
    if (this.canControl && this.canGoNext) return this.callPlayer("Next");
  }
  previous() {
    if (this.canControl && this.canGoPrevious)
      return this.callPlayer("Previous");
  }
  pause() {
    if (this.canControl && this.canPause) return this.callPlayer("Pause");
  }
  playPause() {
    if (this.canControl && (this.canPlay || this.canPause))
      return this.callPlayer("PlayPause");
  }
  stop() {
    if (this.canControl) return this.callPlayer("Stop");
  }
  play() {
    if (this.canControl && this.canPlay) return this.callPlayer("Play");
  }
  setPosition(trackId, positionMicroseconds) {
    if (
      !this.canControl ||
      !this.canSeek ||
      !trackId ||
      !Number.isFinite(positionMicroseconds)
    )
      return;
    return this.callPlayer(
      "SetPosition",
      new GLib.Variant("(ox)", [
        String(trackId),
        Math.max(0, Math.trunc(positionMicroseconds)),
      ]),
    );
  }

  openUri(uri) {
    if (this.canControl && uri)
      return this.callPlayer("OpenUri", new GLib.Variant("(s)", [uri]));
  }

  raise() {
    if (this.canRaise) return this.callRoot("Raise");
  }
  quit() {
    if (this.canQuit) return this.callRoot("Quit");
  }

  toggleLoop() {
    if (!this.canControl) return;
    const statuses = [LoopStatus.NONE, LoopStatus.PLAYLIST, LoopStatus.TRACK];
    const current = statuses.indexOf(this.loopStatus);
    this.loopStatus =
      statuses[(current + 1 + statuses.length) % statuses.length];
  }

  toggleShuffle() {
    if (this.canControl) this.shuffle = !this.shuffle;
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
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    this.operationCancellable?.cancel();
    this.operationCancellable = null;

    if (this.pollSourceId !== null) {
      GLib.Source.remove(this.pollSourceId);
      this.pollSourceId = null;
    }
    this.cancelMetadataInvalidation();

    for (const { proxy, signalId, isDbusSignal } of this
      .proxySignalConnections) {
      try {
        if (isDbusSignal) proxy.disconnectSignal(signalId);
        else proxy.disconnect(signalId);
      } catch (error) {
        // The remote owner may already have disappeared.
        logger.debug(
          "An MPRIS signal was already disconnected",
          this.busName,
          error,
        );
      }
    }
    this.proxySignalConnections.length = 0;
    this.positionTracker?.destroy();
    this.propertyChangeListeners.clear();
    this.state = null;
    this.metadataRefreshPromise = null;
    this.hasCurrentTrackMetadata = false;
    this.rootProxy = null;
    this.playerProxy = null;
    this.propertiesProxy = null;
    this.positionTracker = null;
    this.mprisProxyFactory = null;
  }
}
