/**
 * @file enhance.js
 * @module shell.private.gnome.nativecontrols.enhance
 *
 * Applies and reverses Enhance on one GNOME Shell native control surface by
 * projecting injected MediaShell players, artwork, and playback capabilities
 * onto private notification banners. The implementation never becomes an
 * authority for MPRIS state.
 */

import GLib from "gi://GLib";

import { createLogger } from "../../../../shared/logging/logger.js";
import EnhanceNotificationBannerBinding from "./notificationBannerBinding.js";
import {
  connectLockScreenShown,
  resolveLockScreenContext,
  resolveNotificationBannerContext,
  resolveNotificationCenterContext,
  supportsLockScreenContext,
} from "./compatibility.js";
import NotificationBannerGrouping from "./notificationBannerGrouping.js";

const logger = createLogger("EnhanceNativeControls");

const NOTIFICATION_CENTER_CONFIG = Object.freeze({
  resolveContext: resolveNotificationCenterContext,
  grouping: true,
  watchLockScreen: false,
  warnUnavailable: true,
  unavailableWarningKey: "notification-center-context-unavailable",
  unavailableWarningMessage:
    "GNOME Shell notification center banners could not be resolved for Enhance",
  reconcileWarningKey: "notification-center-reconcile-failed",
  reconcileWarningMessage:
    "GNOME Shell notification center Enhance could not be reconciled; preserving native controls",
});

const LOCK_SCREEN_CONFIG = Object.freeze({
  resolveContext: resolveLockScreenContext,
  grouping: false,
  watchLockScreen: true,
  warnUnavailable: false,
  unavailableWarningKey: null,
  unavailableWarningMessage: null,
  reconcileWarningKey: "lock-screen-reconcile-failed",
  reconcileWarningMessage:
    "GNOME Shell lock screen Enhance could not be reconciled; preserving native controls",
});

/** Owns Enhance bindings for one private GNOME Shell native control surface. */
export default class EnhanceNativeControls {
  static supportsLockScreen() {
    return supportsLockScreenContext();
  }

  static createNotificationCenter(options) {
    return new EnhanceNativeControls(options, NOTIFICATION_CENTER_CONFIG);
  }

  static createLockScreen(options) {
    return new EnhanceNativeControls(options, LOCK_SCREEN_CONFIG);
  }

  constructor(
    { artworkService, playbackController, getAvailablePlayers },
    config,
  ) {
    this.artworkService = artworkService;
    this.playbackController = playbackController;
    this.getAvailablePlayers = getAvailablePlayers;
    this.config = config;

    this.context = null;
    this.mediaSourceSignalIds = [];
    this.ownerDestroySignalId = null;
    this.bindings = new Map();
    this.grouping = null;
    this.groupingFailed = false;
    this.reconcileSourceId = null;
    this.lockScreenShownDisconnect = null;
  }

  reconcile() {
    if (!this.config) return;

    try {
      this.ensureLockScreenWatcher();
      this.reconcileContext();
    } catch (error) {
      this.detachContext();
      logger.warnOnce(
        this.config.reconcileWarningKey,
        this.config.reconcileWarningMessage,
        error,
      );
    }
  }

  ensureLockScreenWatcher() {
    if (!this.config.watchLockScreen || this.lockScreenShownDisconnect) return;
    this.lockScreenShownDisconnect = connectLockScreenShown(() =>
      this.scheduleReconcile(),
    );
  }

  reconcileContext() {
    const context = this.config.resolveContext();
    if (!context) {
      this.detachContext();
      if (this.config.warnUnavailable)
        logger.warnOnce(
          this.config.unavailableWarningKey,
          this.config.unavailableWarningMessage,
        );
      return;
    }

    if (this.context?.owner !== context.owner) {
      this.detachContext();
      this.attachContext(context);
    }

    if (this.config.grouping) this.reconcileNotificationBannerGroupingSafely();
    this.reconcileBindings();
  }

  attachContext(context) {
    this.context = context;
    this.groupingFailed = false;

    const scheduleReconcile = () => this.scheduleReconcile();
    this.mediaSourceSignalIds.push(
      context.mediaSource.connect("player-added", scheduleReconcile),
    );
    this.mediaSourceSignalIds.push(
      context.mediaSource.connect("player-removed", scheduleReconcile),
    );
    this.ownerDestroySignalId = context.owner.connect("destroy", () => {
      this.ownerDestroySignalId = null;
      this.detachContext({ restoreNative: false });
    });
  }

  scheduleReconcile() {
    if (!this.config || this.reconcileSourceId !== null) return;

    this.reconcileSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this.reconcileSourceId = null;
      if (this.config) this.reconcile();
      return GLib.SOURCE_REMOVE;
    });
  }

  getPlayerBanners() {
    if (this.grouping) return this.grouping.getPlayerBanners();
    return this.context ? this.context.getPlayerBanners() : [];
  }

  reconcileBindings() {
    if (!this.context) return;

    const playersByBusName = new Map(
      this.getAvailablePlayers()
        .filter((player) => player?.busName)
        .map((player) => [player.busName, player]),
    );
    const currentBanners = new Set();

    for (const [_nativePlayer, banner] of this.getPlayerBanners()) {
      if (!banner) continue;
      currentBanners.add(banner);

      let bindingKey = "unknown";
      try {
        const existingBinding = this.bindings.get(banner);
        if (existingBinding?.active) {
          const player = playersByBusName.get(existingBinding.busName) ?? null;
          if (existingBinding.player === player) {
            existingBinding.schedulePresentationSync();
            continue;
          }
          this.removeBinding(banner);
        }

        const bannerContext = resolveNotificationBannerContext(banner);
        if (!bannerContext) continue;
        bindingKey = bannerContext.busName;

        const player = playersByBusName.get(bannerContext.busName) ?? null;
        if (!player) continue;

        this.createBinding(banner, bannerContext, player);
      } catch (error) {
        this.removeBinding(banner);
        logger.warnOnce(
          `banner-binding:${bindingKey}`,
          "A GNOME Shell notification banner could not use Enhance; keeping that banner native",
          error,
        );
      }
    }

    for (const [banner, binding] of [...this.bindings.entries()]) {
      if (!currentBanners.has(banner) || !binding.active)
        this.removeBinding(banner, {
          restoreNative: currentBanners.has(banner),
        });
    }
  }

  reconcileNotificationBannerGroupingSafely() {
    try {
      this.reconcileNotificationBannerGrouping();
    } catch (error) {
      this.groupingFailed = true;
      this.destroyNotificationBannerGrouping();
      logger.warnOnce(
        "notification-center-grouping-reconcile-failed",
        "GNOME Shell notification banner grouping could not be reconciled; keeping Enhance banners individual",
        error,
      );
    }
  }

  reconcileNotificationBannerGrouping() {
    if (!this.context || !this.config.grouping) {
      this.destroyNotificationBannerGrouping();
      return;
    }

    if (this.groupingFailed) return;

    if (!this.grouping) {
      if (this.context.getPlayerBanners().length === 0) return;

      const grouping = NotificationBannerGrouping.create(this.context, {
        beforeTakeOwnership: () =>
          this.destroyBindings({ restoreNative: false }),
        onBannerRemoving: (banner) =>
          this.removeBinding(banner, { restoreNative: false }),
        onChanged: () => this.scheduleReconcile(),
        onInvalidated: (invalidatedGrouping) => {
          if (this.grouping !== invalidatedGrouping) return;
          this.grouping = null;
          this.groupingFailed = true;
          this.scheduleReconcile();
        },
      });

      if (!grouping) {
        this.groupingFailed = true;
        logger.warnOnce(
          "notification-center-grouping-context-unavailable",
          "GNOME Shell notification banner grouping is unavailable; keeping Enhance banners individual",
        );
        return;
      }

      this.grouping = grouping;
    }

    this.grouping.reconcile();
  }

  destroyNotificationBannerGrouping({ restoreNative = true } = {}) {
    const grouping = this.grouping;
    if (!grouping) return;

    this.grouping = null;
    grouping.destroy({ restoreNative });
  }

  createBinding(banner, bannerContext, player) {
    const binding = new EnhanceNotificationBannerBinding(
      bannerContext,
      player,
      {
        artworkService: this.artworkService,
        playbackController: this.playbackController,
        onDestroyed: (destroyedBinding) => {
          if (this.bindings.get(banner) === destroyedBinding) {
            this.bindings.delete(banner);
            this.scheduleReconcile();
          }
        },
      },
    );

    if (!binding.enable()) return;
    this.bindings.set(banner, binding);
  }

  removeBinding(banner, { restoreNative = true } = {}) {
    const binding = this.bindings.get(banner);
    if (!binding) return;

    this.bindings.delete(banner);
    binding.destroy({ restoreNative });
  }

  destroyBindings({ restoreNative = true } = {}) {
    for (const [banner] of [...this.bindings.entries()])
      this.removeBinding(banner, { restoreNative });
  }

  detachContext({ restoreNative = true } = {}) {
    if (this.config?.grouping)
      this.destroyNotificationBannerGrouping({ restoreNative });
    this.destroyBindings({ restoreNative });

    const context = this.context;
    this.context = null;
    this.groupingFailed = false;
    if (!context) return;

    for (const signalId of this.mediaSourceSignalIds)
      context.mediaSource.disconnect(signalId);
    this.mediaSourceSignalIds = [];

    if (this.ownerDestroySignalId !== null) {
      context.owner.disconnect(this.ownerDestroySignalId);
      this.ownerDestroySignalId = null;
    }
  }

  destroy() {
    if (!this.config) return;

    const lockScreenShownDisconnect = this.lockScreenShownDisconnect;
    this.lockScreenShownDisconnect = null;
    lockScreenShownDisconnect?.();

    if (this.reconcileSourceId !== null) {
      GLib.Source.remove(this.reconcileSourceId);
      this.reconcileSourceId = null;
    }

    this.detachContext();
    this.config = null;
    this.artworkService = null;
    this.playbackController = null;
    this.getAvailablePlayers = null;
  }
}
