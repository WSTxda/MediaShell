/**
 * @file mediaAppRegistry.js
 * @module shell.mpris.mediaAppRegistry
 *
 * Discovers MPRIS bus names, owns MprisMediaApp instances, filters blocked apps,
 * and selects the active media app.
 *
 * The registry watches NameOwnerChanged, creates media-app models through
 * MprisProxyFactory,
 * applies blocked-app filtering, and schedules grace-period removals when an
 * endpoint disappears. It is the source of truth for the active media app shown by
 * MediaShellIndicator and PopupContent.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import {
  DbusDaemonMethods,
  DbusDaemonSignals,
} from "./dbus.js";
import {
  MPRIS_BUS_NAME_PREFIX,
  MprisPlayerProperties,
  MprisRootProperties,
} from "./protocol.js";
import {
  MEDIA_APP_DISAPPEARANCE_GRACE_MS,
  MediaAppStateProperties,
} from "../constants/mediaApp.js";
import { DBUS_LIST_NAMES_TIMEOUT_MS } from "../constants/mpris.js";
import { normalizeUniqueStrings } from "../../shared/format.js";
import { createLogger } from "../../shared/logging/logger.js";
import { isCancellationError } from "../utils/errors.js";
import MprisMediaApp from "./mprisMediaApp.js";
import {
  chooseNextMediaApp,
  chooseReconciledMediaApp,
  orderMediaAppsDeterministically,
} from "./mediaAppSelectionPolicy.js";

Gio._promisify(Gio.DBusProxy.prototype, "call", "call_finish");

const logger = createLogger("MediaAppRegistry");

/**
 * Discovers MPRIS bus names, owns MprisMediaApp instances, filters blocked apps,
 * and selects the active media app.
 */
export default class MediaAppRegistry {
  constructor(mprisProxyFactory, desktopAppResolver, callbacks = {}) {
    this.mprisProxyFactory = mprisProxyFactory;
    this.desktopAppResolver = desktopAppResolver;
    this.onAvailableMediaAppsChanged = callbacks.onAvailableMediaAppsChanged;
    this.onActiveMediaAppChanged = callbacks.onActiveMediaAppChanged;
    this.mediaAppsByBusName = new Map();
    this.availableMediaApps = [];
    this.pendingMediaAppsByBusName = new Map();
    this.pendingRemovalBusNames = new Set();
    this.pendingRemovalSourceIds = new Map();
    this.pendingRemovalAppStateConnections = new Map();
    this.blockedAppIds = new Set();
    this.activeMediaApp = null;
    this.previousActiveBusName = null;
    this.busDaemonProxy = null;
    this.nameOwnerChangedSignalId = null;
    this.busDaemonOwnerSignalId = null;
    this.operationCancellable = new Gio.Cancellable();
    this.lifecycleGeneration = 0;
  }

  get isDestroyed() {
    return this.operationCancellable === null;
  }

  async init() {
    const lifecycleGeneration = ++this.lifecycleGeneration;
    const busDaemonProxy = await this.mprisProxyFactory.createBusDaemonProxy(
      this.operationCancellable,
    );
    if (this.isDestroyed || lifecycleGeneration !== this.lifecycleGeneration)
      return;
    this.busDaemonProxy = busDaemonProxy;

    this.busDaemonOwnerSignalId = this.busDaemonProxy.connect(
      "notify::g-name-owner",
      () => this.handleBusOwnerChanged(),
    );
    this.nameOwnerChangedSignalId = this.busDaemonProxy.connectSignal(
      DbusDaemonSignals.NAME_OWNER_CHANGED,
      (_proxy, _sender, [busName, _oldOwner, newOwner]) => {
        if (!busName.startsWith(MPRIS_BUS_NAME_PREFIX)) return;

        if (!newOwner) this.scheduleMediaAppRemoval(busName);
        else this.reconcileMediaAppOwner(busName);
      },
    );

    try {
      await this.discoverRunningMediaApps();
    } catch (error) {
      if (isCancellationError(error)) return;
      // The owner-change signal remains active, so media apps can still be
      // discovered later even if the initial ListNames call failed.
      logger.warn("Initial MPRIS app discovery failed", error);
    }
  }

  handleBusOwnerChanged() {
    if (this.isDestroyed || !this.busDaemonProxy) return;

    if (!this.busDaemonProxy.get_name_owner()) {
      for (const busName of this.mediaAppsByBusName.keys())
        this.scheduleMediaAppRemoval(busName);
      return;
    }

    this.discoverRunningMediaApps().catch((error) => {
      if (!isCancellationError(error))
        logger.warn(
          "Failed to rediscover MPRIS apps after D-Bus recovery",
          error,
        );
    });
  }

  reconcileMediaAppOwner(busName) {
    const mediaApp = this.mediaAppsByBusName.get(busName);
    if (!mediaApp) {
      this.registerMediaApp(busName).catch((error) => {
        if (!isCancellationError(error))
          logger.warnOnce(
            `register:${busName}`,
            "Failed to add MPRIS app",
            busName,
            error,
          );
      });
      return;
    }

    // Gio.DBusProxy follows the owner of a well-known name, flushes its
    // cached properties when the owner disappears, and reloads them when
    // a new owner appears. Keep the same MprisMediaApp and available-media-app
    // actors
    // so a direct old-owner -> new-owner hand-off does not destroy and rebuild
    // the top bar between adjacent browser media sessions.
    this.cancelScheduledRemoval(busName);
    mediaApp.adoptCurrentNameOwner();
    mediaApp.refreshMetadata().catch((error) => {
      if (!isCancellationError(error))
        logger.debugOnce(
          `owner-recovery-metadata:${busName}`,
          "Metadata refresh failed after MPRIS owner recovery",
          busName,
          error,
        );
    });
    this.refreshAvailableMediaApps();
    this.reconcileActiveMediaApp();
  }

  async discoverRunningMediaApps() {
    if (!this.busDaemonProxy || this.isDestroyed) return;

    const listNamesResult = await this.busDaemonProxy.call(
      DbusDaemonMethods.LIST_NAMES,
      null,
      Gio.DBusCallFlags.NONE,
      DBUS_LIST_NAMES_TIMEOUT_MS,
      this.operationCancellable,
    );
    const [busNames] = listNamesResult.deepUnpack();
    const mediaAppBusNames = busNames.filter((busName) =>
      busName.startsWith(MPRIS_BUS_NAME_PREFIX),
    );
    const registrationResults = await Promise.allSettled(
      mediaAppBusNames.map((busName) => {
        if (this.mediaAppsByBusName.has(busName)) {
          this.reconcileMediaAppOwner(busName);
          return Promise.resolve();
        }
        return this.registerMediaApp(busName);
      }),
    );

    for (let index = 0; index < registrationResults.length; index++) {
      const registrationResult = registrationResults[index];
      if (registrationResult.status === "rejected")
        logger.warn(
          "A discovered MPRIS app could not be initialized",
          mediaAppBusNames[index],
          registrationResult.reason,
        );
    }
  }

  async registerMediaApp(busName) {
    if (
      this.isDestroyed ||
      this.mediaAppsByBusName.has(busName) ||
      this.pendingMediaAppsByBusName.has(busName)
    )
      return;

    const lifecycleGeneration = this.lifecycleGeneration;
    const mediaApp = new MprisMediaApp(busName, this.mprisProxyFactory);
    let adopted = false;
    this.pendingMediaAppsByBusName.set(busName, mediaApp);

    try {
      const initialized = await mediaApp.init();
      if (
        !initialized ||
        mediaApp.isDestroyed ||
        this.isDestroyed ||
        lifecycleGeneration !== this.lifecycleGeneration ||
        this.pendingMediaAppsByBusName.get(busName) !== mediaApp
      ) {
        mediaApp.destroy();
        return;
      }

      if (
        this.desktopAppResolver.isMediaAppBlocked(
          mediaApp.identity,
          mediaApp.desktopEntry,
          this.blockedAppIds,
          mediaApp.busName,
        )
      ) {
        mediaApp.destroy();
        return;
      }

      mediaApp.onPropertyChanged(MediaAppStateProperties.IS_PINNED, () =>
        this.reconcileActiveMediaApp(),
      );
      mediaApp.onPropertyChanged(MprisPlayerProperties.PLAYBACK_STATUS, () =>
        this.reconcileActiveMediaApp(),
      );
      mediaApp.onPropertyChanged(
        MediaAppStateProperties.IS_MEDIA_APP_INVALID,
        () => {
          this.refreshAvailableMediaApps();
          this.reconcileActiveMediaApp();
        },
      );
      const revalidateIdentity = () => {
        if (
          this.desktopAppResolver.isMediaAppBlocked(
            mediaApp.identity,
            mediaApp.desktopEntry,
            this.blockedAppIds,
            mediaApp.busName,
          )
        ) {
          this.unregisterMediaApp(mediaApp.busName);
          return;
        }
        // Identity changes can alter the resolved name or icon even
        // when the available proxy list itself is unchanged.
        this.refreshAvailableMediaApps(true);
      };
      mediaApp.onPropertyChanged(
        MprisRootProperties.IDENTITY,
        revalidateIdentity,
      );
      mediaApp.onPropertyChanged(
        MprisRootProperties.DESKTOP_ENTRY,
        revalidateIdentity,
      );

      this.mediaAppsByBusName.set(busName, mediaApp);
      adopted = true;
      this.refreshAvailableMediaApps();
      this.reconcileActiveMediaApp();
    } catch (error) {
      if (!isCancellationError(error)) throw error;
    } finally {
      if (this.pendingMediaAppsByBusName.get(busName) === mediaApp)
        this.pendingMediaAppsByBusName.delete(busName);
      if (!adopted && !mediaApp.isDestroyed) mediaApp.destroy();
    }
  }

  scheduleMediaAppRemoval(busName) {
    const pendingMediaApp = this.pendingMediaAppsByBusName.get(busName);
    if (pendingMediaApp) {
      this.unregisterMediaApp(busName);
      return;
    }
    const mediaApp = this.mediaAppsByBusName.get(busName);
    if (!mediaApp || this.pendingRemovalSourceIds.has(busName)) return;

    this.pendingRemovalBusNames.add(busName);

    // D-Bus ownership is the lifecycle authority. Hide the ownerless
    // endpoint from the selector immediately, but retain the active media app
    // for a bounded hand-off window so a replacement owner can reuse it.
    this.refreshAvailableMediaApps();
    this.reconcileActiveMediaApp();

    // Shell.App state may only corroborate the D-Bus owner loss when MPRIS
    // supplies an exact DesktopEntry. Presentation heuristics are explicitly
    // excluded from lifecycle decisions.
    if (this.observeExactMediaAppShutdown(busName, mediaApp)) return;

    const sourceId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      MEDIA_APP_DISAPPEARANCE_GRACE_MS,
      () => {
        this.pendingRemovalSourceIds.delete(busName);
        const mediaApp = this.mediaAppsByBusName.get(busName);
        if (mediaApp?.hasBusOwner) this.reconcileMediaAppOwner(busName);
        else {
          this.unregisterMediaApp(busName);
        }
        return GLib.SOURCE_REMOVE;
      },
    );
    this.pendingRemovalSourceIds.set(busName, sourceId);
  }

  observeExactMediaAppShutdown(busName, mediaApp) {
    const shellApp = this.desktopAppResolver.resolveLifecycleShellApp(
      mediaApp.desktopEntry,
    );
    const removeIfStopped = () => {
      if (
        !this.pendingRemovalBusNames.has(busName) ||
        !this.desktopAppResolver.isShellAppStopped(shellApp)
      )
        return false;

      this.unregisterMediaApp(busName);
      return true;
    };

    if (removeIfStopped()) return true;
    if (!shellApp || typeof shellApp.connect !== "function") return false;

    try {
      const stateSignalId = shellApp.connect("notify::state", removeIfStopped);
      this.pendingRemovalAppStateConnections.set(busName, {
        shellApp,
        stateSignalId,
      });

      // Close the race between the initial state read and signal
      // connection without introducing polling.
      return removeIfStopped();
    } catch (error) {
      logger.debugOnce(
        `shell-app-state:${busName}`,
        "Could not observe exact Shell app state during MPRIS hand-off",
        busName,
        error,
      );
      return false;
    }
  }

  cancelScheduledRemoval(busName) {
    let canceled = false;
    const sourceId = this.pendingRemovalSourceIds.get(busName);
    if (sourceId !== undefined) {
      GLib.Source.remove(sourceId);
      this.pendingRemovalSourceIds.delete(busName);
      canceled = true;
    }

    const stateSignal = this.pendingRemovalAppStateConnections.get(busName);
    if (stateSignal) {
      stateSignal.shellApp.disconnect(stateSignal.stateSignalId);
      this.pendingRemovalAppStateConnections.delete(busName);
      canceled = true;
    }

    if (this.pendingRemovalBusNames.delete(busName)) canceled = true;
    return canceled;
  }

  unregisterMediaApp(busName) {
    this.cancelScheduledRemoval(busName);
    const pendingMediaApp = this.pendingMediaAppsByBusName.get(busName);
    if (pendingMediaApp) {
      pendingMediaApp.destroy();
      this.pendingMediaAppsByBusName.delete(busName);
    }

    const mediaApp = this.mediaAppsByBusName.get(busName);
    if (!mediaApp) return;

    mediaApp.destroy();
    this.mediaAppsByBusName.delete(busName);
    this.refreshAvailableMediaApps();
    this.reconcileActiveMediaApp();
  }

  refreshAvailableMediaApps(forceNotification = false) {
    const nextAvailableMediaApps = orderMediaAppsDeterministically(
      [...this.mediaAppsByBusName.values()].filter(
        (mediaApp) =>
          !mediaApp.isMediaAppInvalid &&
          !this.pendingRemovalBusNames.has(mediaApp.busName),
      ),
    );
    const listChanged =
      nextAvailableMediaApps.length !== this.availableMediaApps.length ||
      nextAvailableMediaApps.some(
        (mediaApp, index) => mediaApp !== this.availableMediaApps[index],
      );
    if (!listChanged && !forceNotification) return false;

    this.availableMediaApps = nextAvailableMediaApps;
    this.invokeCallbackSafely(
      this.onAvailableMediaAppsChanged,
      this.availableMediaApps,
      "available-media-apps-changed",
    );
    return true;
  }

  getAvailableMediaApps() {
    return this.availableMediaApps;
  }

  getPinnedMediaApp() {
    return (
      orderMediaAppsDeterministically([
        ...this.mediaAppsByBusName.values(),
      ]).find((mediaApp) => mediaApp.isPinned) ?? null
    );
  }

  isRegisteredMediaApp(mediaApp) {
    return Boolean(
      !this.isDestroyed &&
      mediaApp &&
      !mediaApp.isMediaAppInvalid &&
      !this.pendingRemovalBusNames.has(mediaApp.busName) &&
      this.mediaAppsByBusName.get(mediaApp.busName) === mediaApp,
    );
  }

  #setActiveMediaApp(mediaApp, { remember = true } = {}) {
    if (mediaApp && remember) this.previousActiveBusName = mediaApp.busName;
    if (this.activeMediaApp === mediaApp) return false;

    this.activeMediaApp = mediaApp;
    this.invokeCallbackSafely(
      this.onActiveMediaAppChanged,
      mediaApp,
      "active-media-app-changed",
    );
    return true;
  }

  selectMediaApp(mediaApp) {
    if (!this.isRegisteredMediaApp(mediaApp)) return false;

    const pinnedMediaApp = this.getPinnedMediaApp();
    if (pinnedMediaApp && pinnedMediaApp !== mediaApp) return false;

    this.#setActiveMediaApp(mediaApp);
    return true;
  }

  switchMediaApp() {
    if (this.getPinnedMediaApp()) return false;

    const targetMediaApp = chooseNextMediaApp(
      this.getAvailableMediaApps(),
      this.activeMediaApp,
    );
    return targetMediaApp ? this.selectMediaApp(targetMediaApp) : false;
  }

  pinMediaApp(mediaApp) {
    if (!this.isRegisteredMediaApp(mediaApp)) return false;

    const pinnedMediaApp = this.getPinnedMediaApp();
    if (pinnedMediaApp && pinnedMediaApp !== mediaApp) {
      return false;
    }
    if (!this.selectMediaApp(mediaApp)) return false;
    if (mediaApp.isPinned) return true;

    mediaApp.pin();
    return true;
  }

  unpinMediaApp(mediaApp) {
    if (
      this.isDestroyed ||
      !mediaApp ||
      this.mediaAppsByBusName.get(mediaApp.busName) !== mediaApp ||
      !mediaApp.isPinned
    )
      return false;

    mediaApp.unpin();
    return true;
  }

  toggleMediaAppPin(mediaApp) {
    if (!mediaApp) return false;
    return mediaApp.isPinned
      ? this.unpinMediaApp(mediaApp)
      : this.pinMediaApp(mediaApp);
  }

  reconcileActiveMediaApp() {
    const pendingActiveMediaApp =
      this.previousActiveBusName &&
      this.pendingRemovalBusNames.has(this.previousActiveBusName)
        ? (this.mediaAppsByBusName.get(this.previousActiveBusName) ?? null)
        : null;
    const nextActiveMediaApp = chooseReconciledMediaApp(
      this.availableMediaApps,
      this.previousActiveBusName,
      pendingActiveMediaApp,
    );

    // Preserve the previous bus name while the UI is intentionally empty
    // during an owner hand-off. A real replacement updates it normally.
    this.#setActiveMediaApp(nextActiveMediaApp, {
      remember: nextActiveMediaApp !== null,
    });
  }

  invokeCallbackSafely(callback, value, eventName) {
    try {
      callback?.(value);
    } catch (error) {
      logger.errorOnce(
        `callback:${eventName}`,
        `Registry callback failed: ${eventName}`,
        error,
      );
    }
  }

  async setBlockedAppIds(blockedAppIds) {
    this.blockedAppIds = new Set(normalizeUniqueStrings(blockedAppIds));

    for (const mediaApp of [...this.mediaAppsByBusName.values()]) {
      if (
        this.desktopAppResolver.isMediaAppBlocked(
          mediaApp.identity,
          mediaApp.desktopEntry,
          this.blockedAppIds,
          mediaApp.busName,
        )
      ) {
        this.unregisterMediaApp(mediaApp.busName);
      }
    }

    try {
      await this.discoverRunningMediaApps();
    } catch (error) {
      if (!isCancellationError(error))
        logger.warn(
          "Failed to refresh media apps after blocked-app change",
          error,
        );
    }
  }

  destroy() {
    const operationCancellable = this.operationCancellable;
    if (!operationCancellable) return;

    this.operationCancellable = null;
    this.lifecycleGeneration++;
    operationCancellable.cancel();

    if (this.busDaemonProxy && this.nameOwnerChangedSignalId !== null)
      this.busDaemonProxy.disconnectSignal(this.nameOwnerChangedSignalId);
    if (this.busDaemonProxy && this.busDaemonOwnerSignalId !== null)
      this.busDaemonProxy.disconnect(this.busDaemonOwnerSignalId);

    for (const busName of [...this.pendingRemovalBusNames])
      this.cancelScheduledRemoval(busName);
    this.pendingRemovalSourceIds.clear();
    this.pendingRemovalAppStateConnections.clear();
    this.pendingRemovalBusNames.clear();

    for (const mediaApp of this.mediaAppsByBusName.values()) mediaApp.destroy();
    for (const mediaApp of this.pendingMediaAppsByBusName.values())
      mediaApp.destroy();

    this.mediaAppsByBusName.clear();
    this.availableMediaApps = [];
    this.pendingMediaAppsByBusName.clear();
    this.activeMediaApp = null;
    this.previousActiveBusName = null;
    this.busDaemonProxy = null;
    this.desktopAppResolver = null;
    this.nameOwnerChangedSignalId = null;
    this.busDaemonOwnerSignalId = null;
    this.onAvailableMediaAppsChanged = null;
    this.onActiveMediaAppChanged = null;
    this.mprisProxyFactory = null;
  }
}
