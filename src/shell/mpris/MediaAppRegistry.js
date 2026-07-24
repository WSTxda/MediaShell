/**
 * @file MediaAppRegistry.js
 * @module shell.mpris.MediaAppRegistry
 *
 * Discovers MPRIS bus names, owns PlayerProxy instances, filters blocked apps,
 * and selects the active media app.
 *
 * The registry watches NameOwnerChanged, creates proxies through MprisProxyFactory,
 * applies blocked-app filtering, and schedules grace-period removals when an
 * endpoint disappears. It is the source of truth for the active media app shown by
 * TopBarButton and PopupContent.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import {
  DbusMethods,
  DbusSignals,
  MPRIS_PREFIX,
  MprisPlayerProperties,
  MprisRootProperties,
} from "../../shared/constants/dbus.js";
import { MediaAppStateProperties } from "../../shared/constants/mediaApp.js";
import {
  DBUS_LIST_NAMES_TIMEOUT_MS,
  MEDIA_APP_DISAPPEARANCE_GRACE_MS,
} from "../../shared/constants/timing.js";
import { PlaybackStatus } from "../../shared/enums/playback.js";
import { normalizeUniqueStrings } from "../../shared/utils/format.js";
import { createLogger } from "../../shared/utils/log.js";
import MediaAppResolver from "../services/MediaAppResolver.js";
import { isCancellationError } from "../utils/errors.js";
import PlayerProxy from "./PlayerProxy.js";
import {
  chooseActiveMediaApp,
  chooseNextMediaApp,
} from "./mediaAppSelectionPolicy.js";

Gio._promisify(Gio.DBusProxy.prototype, "call", "call_finish");

const logger = createLogger("MediaAppRegistry");

/**
 * Discovers MPRIS bus names, owns PlayerProxy instances, filters blocked apps,
 * and selects the active media app.
 */
export default class MediaAppRegistry {
  constructor(mprisProxyFactory, callbacks = {}) {
    this.mprisProxyFactory = mprisProxyFactory;
    this.onAvailableMediaAppsChanged = callbacks.onAvailableMediaAppsChanged;
    this.onActiveMediaAppChanged = callbacks.onActiveMediaAppChanged;
    this.mediaAppProxies = new Map();
    this.availableMediaApps = [];
    this.pendingMediaAppProxies = new Map();
    this.pendingRemovalBusNames = new Set();
    this.pendingRemovalSourceIds = new Map();
    this.pendingRemovalAppStateConnections = new Map();
    this.blockedAppIds = new Set();
    this.activeMediaApp = null;
    this.dbusProxy = null;
    this.mediaAppResolver = MediaAppResolver.getInstance();
    this.nameOwnerChangedSignalId = null;
    this.dbusOwnerSignalId = null;
    this.operationCancellable = new Gio.Cancellable();
    this.isDestroyed = false;
    this.lifecycleGeneration = 0;
  }

  async init() {
    const lifecycleGeneration = ++this.lifecycleGeneration;
    const dbusProxy = await this.mprisProxyFactory.createBusProxy(
      this.operationCancellable,
    );
    if (this.isDestroyed || lifecycleGeneration !== this.lifecycleGeneration)
      return;
    this.dbusProxy = dbusProxy;

    this.dbusOwnerSignalId = this.dbusProxy.connect(
      "notify::g-name-owner",
      () => this.handleBusOwnerChanged(),
    );
    this.nameOwnerChangedSignalId = this.dbusProxy.connectSignal(
      DbusSignals.NAME_OWNER_CHANGED,
      (_proxy, _sender, [busName, _oldOwner, newOwner]) => {
        if (!busName.startsWith(MPRIS_PREFIX)) return;

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
    if (this.isDestroyed || !this.dbusProxy) return;

    if (!this.dbusProxy.get_name_owner()) {
      for (const busName of this.mediaAppProxies.keys())
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
    const mediaApp = this.mediaAppProxies.get(busName);
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
    // a new owner appears. Keep the same PlayerProxy and available-app actors
    // so a direct old-owner -> new-owner hand-off does not destroy and rebuild
    // the top bar between adjacent browser media sessions.
    this.cancelScheduledRemoval(busName);
    mediaApp.refreshMetadata().catch((error) => {
      if (!isCancellationError(error))
        logger.debug(
          "Metadata refresh failed after MPRIS owner recovery",
          busName,
          error,
        );
    });
    this.refreshAvailableMediaApps();
    this.reconcileActiveMediaApp();
    logger.debug("Reconciled MPRIS app owner", busName);
  }

  async discoverRunningMediaApps() {
    if (!this.dbusProxy || this.isDestroyed) return;

    const listNamesResult = await this.dbusProxy.call(
      DbusMethods.LIST_NAMES,
      null,
      Gio.DBusCallFlags.NONE,
      DBUS_LIST_NAMES_TIMEOUT_MS,
      this.operationCancellable,
    );
    const [busNames] = listNamesResult.deepUnpack();
    const mediaAppBusNames = busNames.filter((busName) =>
      busName.startsWith(MPRIS_PREFIX),
    );
    const registrationResults = await Promise.allSettled(
      mediaAppBusNames.map((busName) => {
        if (this.mediaAppProxies.has(busName)) {
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
      this.mediaAppProxies.has(busName) ||
      this.pendingMediaAppProxies.has(busName)
    )
      return;

    const lifecycleGeneration = this.lifecycleGeneration;
    const mediaAppProxy = new PlayerProxy(busName, this.mprisProxyFactory);
    let adopted = false;
    this.pendingMediaAppProxies.set(busName, mediaAppProxy);

    try {
      const initialized = await mediaAppProxy.init();
      if (
        !initialized ||
        mediaAppProxy.isDestroyed ||
        this.isDestroyed ||
        lifecycleGeneration !== this.lifecycleGeneration ||
        this.pendingMediaAppProxies.get(busName) !== mediaAppProxy
      ) {
        mediaAppProxy.destroy();
        return;
      }

      if (
        this.mediaAppResolver.isMediaAppBlocked(
          mediaAppProxy.identity,
          mediaAppProxy.desktopEntry,
          this.blockedAppIds,
          mediaAppProxy.busName,
        )
      ) {
        logger.debug("Blocked app filtered out:", busName);
        mediaAppProxy.destroy();
        return;
      }

      mediaAppProxy.onPropertyChanged(MediaAppStateProperties.IS_PINNED, () =>
        this.reconcileActiveMediaApp(),
      );
      mediaAppProxy.onPropertyChanged(
        MprisPlayerProperties.PLAYBACK_STATUS,
        () => this.reconcileActiveMediaApp(),
      );
      mediaAppProxy.onPropertyChanged(
        MediaAppStateProperties.IS_MEDIA_APP_INVALID,
        () => {
          this.refreshAvailableMediaApps();
          this.reconcileActiveMediaApp();
        },
      );
      const revalidateIdentity = () => {
        if (
          this.mediaAppResolver.isMediaAppBlocked(
            mediaAppProxy.identity,
            mediaAppProxy.desktopEntry,
            this.blockedAppIds,
            mediaAppProxy.busName,
          )
        ) {
          logger.debug("Blocked app filtered out:", mediaAppProxy.busName);
          this.unregisterMediaApp(mediaAppProxy.busName);
          return;
        }
        // Identity changes can alter the resolved name or icon even
        // when the available proxy list itself is unchanged.
        this.refreshAvailableMediaApps(true);
      };
      mediaAppProxy.onPropertyChanged(
        MprisRootProperties.IDENTITY,
        revalidateIdentity,
      );
      mediaAppProxy.onPropertyChanged(
        MprisRootProperties.DESKTOP_ENTRY,
        revalidateIdentity,
      );

      this.mediaAppProxies.set(busName, mediaAppProxy);
      adopted = true;
      logger.debug("Added MPRIS app", busName);
      this.refreshAvailableMediaApps();
      this.reconcileActiveMediaApp();
    } catch (error) {
      if (!isCancellationError(error)) throw error;
    } finally {
      if (this.pendingMediaAppProxies.get(busName) === mediaAppProxy)
        this.pendingMediaAppProxies.delete(busName);
      if (!adopted && !mediaAppProxy.isDestroyed) mediaAppProxy.destroy();
    }
  }

  scheduleMediaAppRemoval(busName) {
    const pendingMediaAppProxy = this.pendingMediaAppProxies.get(busName);
    if (pendingMediaAppProxy) {
      this.unregisterMediaApp(busName);
      return;
    }
    const mediaApp = this.mediaAppProxies.get(busName);
    if (!mediaApp || this.pendingRemovalSourceIds.has(busName)) return;

    this.pendingRemovalBusNames.add(busName);
    logger.debug(
      `Scheduling removal of ${busName} in ${MEDIA_APP_DISAPPEARANCE_GRACE_MS}ms`,
    );

    // D-Bus ownership is the lifecycle authority. Hide the ownerless
    // endpoint from the selector immediately, but retain the active proxy
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
        const mediaApp = this.mediaAppProxies.get(busName);
        if (mediaApp?.hasBusOwner) this.reconcileMediaAppOwner(busName);
        else {
          logger.debug("Removing", busName, "after grace period");
          this.unregisterMediaApp(busName);
        }
        return GLib.SOURCE_REMOVE;
      },
    );
    this.pendingRemovalSourceIds.set(busName, sourceId);
    logger.debug(
      "Deferred ownerless MPRIS app removal for a possible replacement owner",
      busName,
    );
  }

  observeExactMediaAppShutdown(busName, mediaApp) {
    const shellApp = this.mediaAppResolver.resolveLifecycleShellApp(
      mediaApp.desktopEntry,
    );
    const removeIfStopped = () => {
      if (
        !this.pendingRemovalBusNames.has(busName) ||
        !this.mediaAppResolver.isShellAppStopped(shellApp)
      )
        return false;

      logger.debug(
        "Removed ownerless MPRIS app after its exact desktop app stopped",
        busName,
      );
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
      logger.debug(
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
      try {
        stateSignal.shellApp.disconnect(stateSignal.stateSignalId);
      } catch (error) {
        logger.debug(
          "Shell app state signal was already disconnected",
          busName,
          error,
        );
      }
      this.pendingRemovalAppStateConnections.delete(busName);
      canceled = true;
    }

    if (this.pendingRemovalBusNames.delete(busName)) canceled = true;
    if (canceled) logger.debug("Canceled deferred MPRIS app removal", busName);
    return canceled;
  }

  unregisterMediaApp(busName) {
    this.cancelScheduledRemoval(busName);
    const pendingMediaAppProxy = this.pendingMediaAppProxies.get(busName);
    if (pendingMediaAppProxy) {
      pendingMediaAppProxy.destroy();
      this.pendingMediaAppProxies.delete(busName);
    }

    const mediaAppProxy = this.mediaAppProxies.get(busName);
    if (!mediaAppProxy) return;

    logger.debug("Removed MPRIS app", busName);
    mediaAppProxy.destroy();
    this.mediaAppProxies.delete(busName);
    this.refreshAvailableMediaApps();
    this.reconcileActiveMediaApp();
  }

  refreshAvailableMediaApps(forceNotification = false) {
    const nextAvailableMediaApps = [...this.mediaAppProxies.values()].filter(
      (mediaAppProxy) =>
        !mediaAppProxy.isMediaAppInvalid &&
        !this.pendingRemovalBusNames.has(mediaAppProxy.busName),
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
      [...this.mediaAppProxies.values()].find(
        (mediaApp) => mediaApp.isPinned,
      ) ?? null
    );
  }

  isRegisteredMediaApp(mediaApp) {
    return Boolean(
      !this.isDestroyed &&
      mediaApp &&
      !mediaApp.isMediaAppInvalid &&
      !this.pendingRemovalBusNames.has(mediaApp.busName) &&
      this.mediaAppProxies.get(mediaApp.busName) === mediaApp,
    );
  }

  selectMediaApp(mediaApp) {
    if (!this.isRegisteredMediaApp(mediaApp)) return false;

    const pinnedMediaApp = this.getPinnedMediaApp();
    if (pinnedMediaApp && pinnedMediaApp !== mediaApp) return false;

    if (this.activeMediaApp === mediaApp) return true;
    this.activeMediaApp = mediaApp;
    this.invokeCallbackSafely(
      this.onActiveMediaAppChanged,
      mediaApp,
      "active-media-app-changed",
    );
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
      logger.debug(
        "Ignored pin request while another media app is pinned",
        mediaApp.busName,
        pinnedMediaApp.busName,
      );
      return false;
    }
    if (!this.selectMediaApp(mediaApp)) return false;
    if (mediaApp.isPinned) return true;

    mediaApp.pin();
    logger.debug("Pinned media app", mediaApp.busName);
    return true;
  }

  unpinMediaApp(mediaApp) {
    if (
      this.isDestroyed ||
      !mediaApp ||
      this.mediaAppProxies.get(mediaApp.busName) !== mediaApp ||
      !mediaApp.isPinned
    )
      return false;

    mediaApp.unpin();
    logger.debug("Unpinned media app", mediaApp.busName);
    return true;
  }

  toggleMediaAppPin(mediaApp) {
    if (!mediaApp) return false;
    return mediaApp.isPinned
      ? this.unpinMediaApp(mediaApp)
      : this.pinMediaApp(mediaApp);
  }

  reconcileActiveMediaApp() {
    const availableMediaApps = [...this.mediaAppProxies.values()].filter(
      (mediaApp) => !this.pendingRemovalBusNames.has(mediaApp.busName),
    );
    let nextActiveMediaApp = chooseActiveMediaApp(
      availableMediaApps,
      this.activeMediaApp?.busName ?? null,
    );

    // Ownerless endpoints should leave the visible UI immediately. Keep
    // the proxy only as an internal hand-off candidate; if a replacement
    // owner appears during the grace period, reconcileMediaAppOwner() will
    // make it visible again without retaining stale controls in the top bar.
    const activeMediaAppIsPending =
      this.activeMediaApp &&
      this.pendingRemovalBusNames.has(this.activeMediaApp.busName);
    const replacementShouldTakeOver =
      nextActiveMediaApp &&
      !this.activeMediaApp?.isPinned &&
      (nextActiveMediaApp.isPinned ||
        nextActiveMediaApp.playbackStatus === PlaybackStatus.PLAYING);
    if (activeMediaAppIsPending && !replacementShouldTakeOver)
      nextActiveMediaApp = null;

    if (nextActiveMediaApp?.busName === this.activeMediaApp?.busName) return;

    this.activeMediaApp = nextActiveMediaApp;
    this.invokeCallbackSafely(
      this.onActiveMediaAppChanged,
      nextActiveMediaApp,
      "active-media-app-changed",
    );
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

    for (const mediaAppProxy of [...this.mediaAppProxies.values()]) {
      if (
        this.mediaAppResolver.isMediaAppBlocked(
          mediaAppProxy.identity,
          mediaAppProxy.desktopEntry,
          this.blockedAppIds,
          mediaAppProxy.busName,
        )
      ) {
        logger.debug("Blocked app filtered out:", mediaAppProxy.busName);
        this.unregisterMediaApp(mediaAppProxy.busName);
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
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.lifecycleGeneration++;

    this.operationCancellable?.cancel();
    this.operationCancellable = null;

    if (this.dbusProxy && this.nameOwnerChangedSignalId !== null) {
      try {
        this.dbusProxy.disconnectSignal(this.nameOwnerChangedSignalId);
      } catch (error) {
        logger.debug("D-Bus owner signal was already disconnected", error);
      }
    }
    if (this.dbusProxy && this.dbusOwnerSignalId !== null) {
      try {
        this.dbusProxy.disconnect(this.dbusOwnerSignalId);
      } catch (error) {
        logger.debug("D-Bus owner monitor was already disconnected", error);
      }
    }

    for (const busName of [...this.pendingRemovalBusNames])
      this.cancelScheduledRemoval(busName);
    this.pendingRemovalSourceIds.clear();
    this.pendingRemovalAppStateConnections.clear();
    this.pendingRemovalBusNames.clear();

    for (const mediaAppProxy of this.mediaAppProxies.values())
      mediaAppProxy.destroy();
    for (const mediaAppProxy of this.pendingMediaAppProxies.values())
      mediaAppProxy.destroy();

    this.mediaAppProxies.clear();
    this.availableMediaApps = [];
    this.pendingMediaAppProxies.clear();
    this.activeMediaApp = null;
    this.dbusProxy = null;
    this.mediaAppResolver = null;
    this.nameOwnerChangedSignalId = null;
    this.dbusOwnerSignalId = null;
    this.onAvailableMediaAppsChanged = null;
    this.onActiveMediaAppChanged = null;
    this.mprisProxyFactory = null;
  }
}
