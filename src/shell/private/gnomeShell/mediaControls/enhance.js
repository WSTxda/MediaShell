/**
 * @file enhance.js
 * @module shell.private.gnomeShell.mediaControls.enhance
 *
 * Reversibly enhances one GNOME Shell media surface by projecting injected
 * MediaShell players, artwork, and playback capabilities onto private native
 * messages. The implementation never becomes an authority for MPRIS state.
 */

import GLib from "gi://GLib";

import { createLogger } from "../../../../shared/logging/logger.js";
import EnhancedMediaMessageBinding from "./messageBinding.js";
import {
  connectLockScreenShown,
  resolveLockScreenMediaContext,
  resolveMediaMessageContext,
  resolveNotificationListMediaContext,
  supportsLockScreenMediaContext,
} from "./compatibility.js";
import MediaMessageGrouping from "./grouping.js";

const logger = createLogger("EnhancedNativeMediaControls");

const NOTIFICATION_LIST_CONFIG = Object.freeze({
  resolveContext: resolveNotificationListMediaContext,
  grouping: true,
  watchLockScreen: false,
  warnUnavailable: true,
  unavailableWarningKey: "notification-list-context-unavailable",
  unavailableWarningMessage:
    "GNOME Shell notification-list media messages could not be resolved for enhancement",
  reconcileWarningKey: "notification-list-reconcile-failed",
  reconcileWarningMessage:
    "GNOME Shell notification-list media enhancement could not be reconciled; preserving native controls",
});

const LOCK_SCREEN_CONFIG = Object.freeze({
  resolveContext: resolveLockScreenMediaContext,
  grouping: false,
  watchLockScreen: true,
  warnUnavailable: false,
  unavailableWarningKey: null,
  unavailableWarningMessage: null,
  reconcileWarningKey: "lock-screen-reconcile-failed",
  reconcileWarningMessage:
    "GNOME Shell lock-screen media enhancement could not be reconciled; preserving native controls",
});

/** Owns enhancement bindings for one private GNOME Shell media surface. */
export default class EnhancedMediaControls {
  static supportsLockScreen() {
    return supportsLockScreenMediaContext();
  }

  static createNotificationList(options) {
    return new EnhancedMediaControls(options, NOTIFICATION_LIST_CONFIG);
  }

  static createLockScreen(options) {
    return new EnhancedMediaControls(options, LOCK_SCREEN_CONFIG);
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

    if (this.config.grouping) this.reconcileNotificationGroupingSafely();
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

  getPlayerMessages() {
    if (this.grouping) return this.grouping.getPlayerMessages();
    return this.context ? this.context.getPlayerMessages() : [];
  }

  reconcileBindings() {
    if (!this.context) return;

    const playersByBusName = new Map(
      this.getAvailablePlayers()
        .filter((player) => player?.busName)
        .map((player) => [player.busName, player]),
    );
    const currentMessages = new Set();

    for (const [_nativePlayer, message] of this.getPlayerMessages()) {
      if (!message) continue;
      currentMessages.add(message);

      let bindingKey = "unknown";
      try {
        const existingBinding = this.bindings.get(message);
        if (existingBinding?.active) {
          const player = playersByBusName.get(existingBinding.busName) ?? null;
          if (existingBinding.player === player) {
            existingBinding.schedulePresentationSync();
            continue;
          }
          this.removeBinding(message);
        }

        const messageContext = resolveMediaMessageContext(message);
        if (!messageContext) continue;
        bindingKey = messageContext.busName;

        const player = playersByBusName.get(messageContext.busName) ?? null;
        if (!player) continue;

        this.createBinding(message, messageContext, player);
      } catch (error) {
        this.removeBinding(message);
        logger.warnOnce(
          `message-binding:${bindingKey}`,
          "A GNOME Shell media message could not be enhanced; keeping that message native",
          error,
        );
      }
    }

    for (const [message, binding] of [...this.bindings.entries()]) {
      if (!currentMessages.has(message) || !binding.active)
        this.removeBinding(message, {
          restoreNative: currentMessages.has(message),
        });
    }
  }

  reconcileNotificationGroupingSafely() {
    try {
      this.reconcileNotificationGrouping();
    } catch (error) {
      this.groupingFailed = true;
      this.destroyNotificationGrouping();
      logger.warnOnce(
        "notification-list-grouping-reconcile-failed",
        "GNOME Shell media-message grouping could not be reconciled; keeping enhanced messages individual",
        error,
      );
    }
  }

  reconcileNotificationGrouping() {
    if (!this.context || !this.config.grouping) {
      this.destroyNotificationGrouping();
      return;
    }

    if (this.groupingFailed) return;

    if (!this.grouping) {
      if (this.context.getPlayerMessages().length === 0) return;

      const grouping = MediaMessageGrouping.create(this.context, {
        beforeTakeOwnership: () =>
          this.destroyBindings({ restoreNative: false }),
        onMessageRemoving: (message) =>
          this.removeBinding(message, { restoreNative: false }),
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
          "notification-list-grouping-context-unavailable",
          "GNOME Shell media-message grouping is unavailable; keeping enhanced messages individual",
        );
        return;
      }

      this.grouping = grouping;
    }

    this.grouping.reconcile();
  }

  destroyNotificationGrouping({ restoreNative = true } = {}) {
    const grouping = this.grouping;
    if (!grouping) return;

    this.grouping = null;
    grouping.destroy({ restoreNative });
  }

  createBinding(message, messageContext, player) {
    const binding = new EnhancedMediaMessageBinding(messageContext, player, {
      artworkService: this.artworkService,
      playbackController: this.playbackController,
      onDestroyed: (destroyedBinding) => {
        if (this.bindings.get(message) === destroyedBinding) {
          this.bindings.delete(message);
          this.scheduleReconcile();
        }
      },
    });

    if (!binding.enable()) return;
    this.bindings.set(message, binding);
  }

  removeBinding(message, { restoreNative = true } = {}) {
    const binding = this.bindings.get(message);
    if (!binding) return;

    this.bindings.delete(message);
    binding.destroy({ restoreNative });
  }

  destroyBindings({ restoreNative = true } = {}) {
    for (const [message] of [...this.bindings.entries()])
      this.removeBinding(message, { restoreNative });
  }

  detachContext({ restoreNative = true } = {}) {
    if (this.config?.grouping)
      this.destroyNotificationGrouping({ restoreNative });
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
