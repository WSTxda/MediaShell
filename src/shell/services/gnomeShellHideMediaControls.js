/**
 * @file gnomeShellHideMediaControls.js
 * @module shell.services.gnomeShellHideMediaControls
 *
 * Reversibly suppresses native media messages in the notification list.
 */

import { createLogger } from "../../shared/utils/log.js";
import { resolveNotificationListMediaContext } from "./gnomeShellMediaControlsCompatibility.js";

const logger = createLogger("GnomeShellHideMediaControls");

export default class GnomeShellHideMediaControls {
  constructor() {
    this.context = null;
    this.removePlayerOverrides = null;
    this.ownerDestroySignalId = null;
    this.hiddenPlayers = new Set();
  }

  reconcile() {
    try {
      this.reconcileContext();
    } catch (error) {
      this.restoreNativeMediaControls();
      logger.warnOnce(
        "notification-list-reconcile-failed",
        "GNOME Shell media controls could not be hidden; preserving native controls",
        error,
      );
    }
  }

  reconcileContext() {
    const context = resolveNotificationListMediaContext();
    if (!context) {
      this.restoreNativeMediaControls();
      logger.warnOnce(
        "notification-list-context-unavailable",
        "GNOME Shell notification-list media controls could not be resolved",
      );
      return;
    }

    if (this.context?.owner === context.owner && this.removePlayerOverrides) {
      this.removeCurrentMediaControls();
      return;
    }

    this.restoreNativeMediaControls();
    if (this.applyPatch(context)) this.removeCurrentMediaControls();
  }

  applyPatch(context) {
    const hiddenPlayers = this.hiddenPlayers;
    let removePlayerOverrides = null;
    let ownerDestroySignalId = null;

    try {
      removePlayerOverrides = context.installPlayerOverrides({
        onAddPlayer: (player) => {
          hiddenPlayers.add(player);
          return undefined;
        },
        onRemovePlayer: (player) => {
          hiddenPlayers.delete(player);
          if (!context.hasMessage(player)) return undefined;
          return context.callOriginalRemovePlayer(player);
        },
      });
      ownerDestroySignalId = context.owner.connect("destroy", () => {
        if (this.context !== context) return;

        this.context = null;
        this.removePlayerOverrides = null;
        this.ownerDestroySignalId = null;
        removePlayerOverrides();
        hiddenPlayers.clear();
      });
    } catch (error) {
      if (ownerDestroySignalId !== null)
        context.owner.disconnect(ownerDestroySignalId);
      removePlayerOverrides?.();
      logger.warnOnce(
        "notification-list-patch-failed",
        "Failed to patch GNOME Shell notification-list media controls",
        error,
      );
      return false;
    }

    this.context = context;
    this.removePlayerOverrides = removePlayerOverrides;
    this.ownerDestroySignalId = ownerDestroySignalId;
    return true;
  }

  removeCurrentMediaControls() {
    const context = this.context;
    if (!context) return;

    for (const player of context.getPlayersWithMessages()) {
      this.hiddenPlayers.add(player);
      try {
        context.callOriginalRemovePlayer(player);
      } catch (error) {
        logger.warnOnce(
          "remove-native-media-control",
          "Failed to hide a GNOME Shell media control",
          error,
        );
      }
    }
  }

  restoreNativeMediaControls() {
    const context = this.context;
    const removePlayerOverrides = this.removePlayerOverrides;
    const ownerDestroySignalId = this.ownerDestroySignalId;

    this.context = null;
    this.removePlayerOverrides = null;
    this.ownerDestroySignalId = null;

    if (context && ownerDestroySignalId !== null)
      context.owner.disconnect(ownerDestroySignalId);
    removePlayerOverrides?.();

    if (!context) {
      this.hiddenPlayers.clear();
      return;
    }

    const players = context.getPlayers();
    const currentPlayers = players ? new Set(players) : null;
    for (const player of this.hiddenPlayers) {
      if (currentPlayers && !currentPlayers.has(player)) continue;
      if (context.hasMessage(player)) continue;

      try {
        context.callOriginalAddPlayer(player);
      } catch (error) {
        logger.warnOnce(
          "restore-native-media-control",
          "Failed to restore a GNOME Shell media control",
          error,
        );
      }
    }
    this.hiddenPlayers.clear();
  }

  destroy() {
    this.restoreNativeMediaControls();
  }
}
