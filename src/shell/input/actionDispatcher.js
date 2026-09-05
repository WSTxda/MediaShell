/**
 * @file actionDispatcher.js
 * @module shell.input.actionDispatcher
 *
 * Translates MediaShell input actions into runtime or application commands.
 *
 * Keyboard shortcuts and indicator pointer gestures share this dispatcher so
 * neither UI surface nor ExtensionController needs to duplicate playback,
 * volume, player-switching, popup, or preferences routing. The dispatcher does
 * not own MediaRuntime; its owner must destroy it before the runtime is torn down.
 */

import {
  PLAYBACK_ACTION_BY_INPUT_ACTION,
  VOLUME_STEP,
} from "../../shared/input/actions.js";
import { InputActions } from "../../shared/input/types.js";

/** Executes canonical input actions against one MediaRuntime and UI host. */
export default class InputActionDispatcher {
  constructor({ mediaRuntime, onTogglePopup, onOpenPreferences } = {}) {
    if (!mediaRuntime)
      throw new TypeError("InputActionDispatcher requires MediaRuntime");

    this.mediaRuntime = mediaRuntime;
    this.onTogglePopup = onTogglePopup;
    this.onOpenPreferences = onOpenPreferences;
  }

  execute(inputAction) {
    if (!this.mediaRuntime) return;

    const playbackAction = PLAYBACK_ACTION_BY_INPUT_ACTION[inputAction];
    if (playbackAction)
      return this.mediaRuntime.playback.execute(playbackAction);

    switch (inputAction) {
      case InputActions.VOLUME_UP:
        return this.mediaRuntime.playback.increaseVolume(VOLUME_STEP);
      case InputActions.VOLUME_DOWN:
        return this.mediaRuntime.playback.decreaseVolume(VOLUME_STEP);
      case InputActions.TOGGLE_POPUP:
        this.onTogglePopup?.();
        return;
      case InputActions.OPEN_PREFERENCES:
        this.onOpenPreferences?.();
        return;
      case InputActions.RAISE_APP:
        return this.mediaRuntime.playback.raise();
      case InputActions.QUIT_APP:
        return this.mediaRuntime.playback.quit();
      case InputActions.SWITCH_APP:
        return this.mediaRuntime.switchPlayer();
      default:
        return;
    }
  }

  destroy() {
    this.mediaRuntime = null;
    this.onTogglePopup = null;
    this.onOpenPreferences = null;
  }
}
