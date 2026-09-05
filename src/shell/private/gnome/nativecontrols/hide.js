/**
 * @file hide.js
 * @module shell.private.gnome.nativecontrols.hide
 *
 * Reversibly removes native media control notification banners from the
 * notification center
 * through the compatibility contract. It owns every override and restores the
 * native banners when the setting, owner, session profile, or extension
 * lifecycle changes.
 */

import { createLogger } from "../../../../shared/logging/logger.js";
import { resolveNotificationCenterContext } from "./compatibility.js";

const logger = createLogger("HideNativeControls");

export default class HideNativeControls {
  constructor() {
    this.context = null;
    this.removePlayerOverrides = null;
    this.ownerDestroySignalId = null;
    this.removedPlayers = new Set();
  }

  reconcile() {
    try {
      this.reconcileContext();
    } catch (error) {
      this.restoreNotificationBanners();
      logger.warnOnce(
        "notification-center-hide-reconcile-failed",
        "GNOME Shell notification center Hide could not be reconciled; preserving native controls",
        error,
      );
    }
  }

  reconcileContext() {
    const context = resolveNotificationCenterContext();
    if (!context) {
      this.restoreNotificationBanners();
      logger.warnOnce(
        "notification-center-context-unavailable",
        "GNOME Shell notification center native controls could not be resolved for Hide",
      );
      return;
    }

    if (this.context?.owner === context.owner && this.removePlayerOverrides) {
      this.removeCurrentNotificationBanners();
      return;
    }

    this.restoreNotificationBanners();
    if (this.applyPatch(context)) this.removeCurrentNotificationBanners();
  }

  applyPatch(context) {
    const removedPlayers = this.removedPlayers;
    let removePlayerOverrides = null;
    let ownerDestroySignalId = null;

    try {
      removePlayerOverrides = context.installPlayerOverrides({
        onAddPlayer: (player) => {
          removedPlayers.add(player);
          return undefined;
        },
        onRemovePlayer: (player) => {
          removedPlayers.delete(player);
          if (!context.hasBanner(player)) return undefined;
          return context.callOriginalRemovePlayer(player);
        },
      });
      ownerDestroySignalId = context.owner.connect("destroy", () => {
        if (this.context !== context) return;

        this.context = null;
        this.removePlayerOverrides = null;
        this.ownerDestroySignalId = null;
        removePlayerOverrides();
        removedPlayers.clear();
      });
    } catch (error) {
      if (ownerDestroySignalId !== null)
        context.owner.disconnect(ownerDestroySignalId);
      removePlayerOverrides?.();
      logger.warnOnce(
        "notification-center-hide-patch-failed",
        "Failed to patch GNOME Shell notification center native controls for Hide",
        error,
      );
      return false;
    }

    this.context = context;
    this.removePlayerOverrides = removePlayerOverrides;
    this.ownerDestroySignalId = ownerDestroySignalId;
    return true;
  }

  removeCurrentNotificationBanners() {
    const context = this.context;
    if (!context) return;

    for (const player of context.getPlayersWithBanners()) {
      this.removedPlayers.add(player);
      try {
        context.callOriginalRemovePlayer(player);
      } catch (error) {
        logger.warnOnce(
          "notification-center-hide-banner-failed",
          "Failed to hide a GNOME Shell native notification banner",
          error,
        );
      }
    }
  }

  restoreNotificationBanners() {
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
      this.removedPlayers.clear();
      return;
    }

    const players = context.getPlayers();
    const currentPlayers = players ? new Set(players) : null;
    for (const player of this.removedPlayers) {
      if (currentPlayers && !currentPlayers.has(player)) continue;
      if (context.hasBanner(player)) continue;

      try {
        context.callOriginalAddPlayer(player);
      } catch (error) {
        logger.warnOnce(
          "notification-center-restore-banner-failed",
          "Failed to restore a GNOME Shell native notification banner after Hide",
          error,
        );
      }
    }
    this.removedPlayers.clear();
  }

  destroy() {
    this.restoreNotificationBanners();
  }
}
