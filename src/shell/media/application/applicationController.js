/**
 * @file applicationController.js
 * @module shell.media.application.applicationController
 *
 * Owns MediaShell actions directed at the desktop application behind MPRIS.
 *
 * PlaybackController remains the canonical MPRIS Raise/Quit boundary. This
 * controller only adds an exact local PWA-window activation path before Raise;
 * unresolved, stale, or failed local resolution delegates to MPRIS unchanged.
 */

import Shell from "gi://Shell";

import { createLogger } from "../../../shared/logging/logger.js";
import { mprisOperationSucceeded } from "../../mpris/operationResult.js";
import PlayerWindowResolver from "./playerWindowResolver.js";

const logger = createLogger("ApplicationController");

/** Coordinates application/window actions above playback and identity domains. */
export default class ApplicationController {
  constructor({
    getActivePlayer,
    desktopAppResolver,
    playbackController,
    createBusDaemonProxy,
  } = {}) {
    if (typeof getActivePlayer !== "function")
      throw new TypeError(
        "ApplicationController requires an active-player getter",
      );
    if (!desktopAppResolver)
      throw new TypeError("ApplicationController requires DesktopAppResolver");
    if (!playbackController)
      throw new TypeError("ApplicationController requires PlaybackController");
    if (typeof createBusDaemonProxy !== "function")
      throw new TypeError(
        "ApplicationController requires a D-Bus daemon proxy factory",
      );

    this.getActivePlayer = getActivePlayer;
    this.playbackController = playbackController;
    this.windowResolver = new PlayerWindowResolver({
      desktopAppResolver,
      createBusDaemonProxy,
    });
  }

  get activePlayer() {
    return this.getActivePlayer?.() ?? null;
  }

  resolveWindow(player = this.activePlayer) {
    return this.windowResolver?.resolve(player) ?? Promise.resolve(null);
  }

  activateResolvedWindow(resolution) {
    const window = resolution?.window ?? null;
    if (!window) return false;

    const timestamp = Shell.Global.get().get_current_time();
    if (resolution.shellApp?.activate_window)
      resolution.shellApp.activate_window(window, timestamp);
    else window.activate(timestamp);
    return true;
  }

  async raise(player = this.activePlayer) {
    if (!player) return this.playbackController.raise(player);

    try {
      const resolution = await this.resolveWindow(player);
      if (resolution && this.activateResolvedWindow(resolution))
        return mprisOperationSucceeded();
    } catch (error) {
      logger.debugOnce(
        `raise-window:${error?.name ?? "Error"}`,
        "Local PWA window activation failed; using MPRIS Raise",
        error,
      );
    }

    return this.playbackController.raise(player);
  }

  destroy() {
    this.windowResolver?.destroy();
    this.windowResolver = null;
    this.playbackController = null;
    this.getActivePlayer = null;
  }
}
