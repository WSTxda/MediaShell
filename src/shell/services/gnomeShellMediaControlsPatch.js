/**
 * @file gnomeShellMediaControlsPatch.js
 * @module shell.services.gnomeShellMediaControlsPatch
 *
 * Applies the optional patch that hides GNOME Shell's default media controls.
 *
 * ExtensionController toggles this service from settings changes. The service
 * owns the monkey-patch boundary and restoration logic so Shell notification UI
 * changes stay isolated from MPRIS and top bar code.
 */

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Mpris from "resource:///org/gnome/shell/ui/mpris.js";
import { InjectionManager } from "resource:///org/gnome/shell/extensions/extension.js";

import { MPRIS_BUS_NAME_PREFIX } from "../../shared/constants/mpris.js";
import { createLogger } from "../../shared/utils/log.js";

const logger = createLogger("GnomeShellMediaControlsPatch");

/**
 * Applies the optional patch that hides GNOME Shell's default media controls.
 */
export default class GnomeShellMediaControlsPatch {
  constructor() {
    this.injectionManager = new InjectionManager();
    this.isHidden = false;
    this.restoreGeneration = 0;
  }

  setGnomeShellMediaControlsHidden(isHidden) {
    if (!this.injectionManager || this.isHidden === isHidden) return;

    this.restoreGeneration++;
    this.injectionManager.clear();
    this.isHidden = false;
    if (!isHidden) {
      const restoreGeneration = this.restoreGeneration;
      void this.restoreCurrentGnomeShellMediaControls(restoreGeneration).catch(
        (error) =>
          logger.warn(
            "Failed to restore current GNOME Shell media controls",
            error,
          ),
      );
      return;
    }

    const sourceClass = this.getGnomeShellMediaSourceClass();
    if (!sourceClass?.prototype?._addPlayer) {
      // The system media implementation is private Shell API. Failing open
      // preserves GNOME's controls when a supported release changes shape.
      logger.warn(
        "GNOME Shell media controls could not be patched on this Shell version",
      );
      return;
    }

    this.injectionManager.overrideMethod(
      sourceClass.prototype,
      "_addPlayer",
      () => function () {},
    );
    this.isHidden = true;
    this.removeCurrentGnomeShellMediaControls();
  }

  getGnomeShellMediaSourceClass() {
    // Every supported Shell release (48+) exposes MprisSource here. The
    // guard above fails open if this private class shape changes again.
    if (Mpris.MprisSource?.prototype?._addPlayer) return Mpris.MprisSource;
    return null;
  }

  removeCurrentGnomeShellMediaControls() {
    const mediaSource = this.getGnomeShellMediaSource();
    // _players is the Map<busName, MprisPlayer> inside the media source
    if (!mediaSource?._players) return;

    for (const [busName, systemPlayer] of [...mediaSource._players.entries()]) {
      try {
        // _onNameOwnerChanged is Shell's internal handler for MPRIS bus
        // disappearance. Calling it with an empty new owner triggers the
        // same cleanup path as a real D-Bus name loss.
        mediaSource._onNameOwnerChanged?.(null, null, [busName, busName, ""]);
        // _close() tears down the private player proxy. Shell would normally
        // call this after the synthetic name loss, but it is not guaranteed.
        systemPlayer._close?.();
      } catch (error) {
        logger.warn("Failed to remove a GNOME Shell media control", error);
      }
    }
  }

  async restoreCurrentGnomeShellMediaControls(restoreGeneration) {
    const mediaSource = this.getGnomeShellMediaSource();
    if (!mediaSource?._proxy?.ListNamesAsync || !mediaSource?._addPlayer)
      return;

    // _proxy is Shell's own D-Bus proxy for the session bus — same one used for
    // NameOwnerChanged. _onProxyReady() sets it up; we reuse it here without
    // calling _onProxyReady() again because that would install duplicate
    // subscriptions. Replay current names only, and discard the result if the
    // setting changes meanwhile.
    const [busNames] = await mediaSource._proxy.ListNamesAsync();
    if (this.isHidden || restoreGeneration !== this.restoreGeneration) return;

    for (const busName of busNames) {
      if (
        busName.startsWith(MPRIS_BUS_NAME_PREFIX) &&
        !mediaSource._players?.has?.(busName)
      )
        mediaSource._addPlayer(busName);
    }
  }

  getGnomeShellMediaSource() {
    // dateMenu is the calendar button. _messageList is its private
    // notification tray actor, stable since GNOME 40.
    const messageList = Main.panel.statusArea.dateMenu?._messageList;
    // Every supported Shell release (48+) exposes the media source under
    // _messageView, the grouped-notifications view introduced in GNOME 48.
    return messageList?._messageView?._mediaSource ?? null;
  }

  destroy() {
    const injectionManager = this.injectionManager;
    if (!injectionManager) return;

    const shouldRestore = this.isHidden;
    const restoreGeneration = ++this.restoreGeneration;
    this.injectionManager = null;
    this.isHidden = false;
    injectionManager.clear();

    if (shouldRestore)
      void this.restoreCurrentGnomeShellMediaControls(restoreGeneration).catch(
        (error) =>
          logger.warn(
            "Failed to restore current GNOME Shell media controls during teardown",
            error,
          ),
      );
  }
}
