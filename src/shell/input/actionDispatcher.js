/**
 * @file actionDispatcher.js
 * @module shell.input.actionDispatcher
 *
 * Translates MediaShell input actions into runtime or application commands.
 *
 * Keyboard shortcuts and indicator pointer gestures share this dispatcher so
 * neither UI surface nor ExtensionController needs to duplicate playback,
 * volume, player-switching, popup, or preferences routing. Input-only visual
 * feedback is injected here so direct Popup, Top Bar playback-control, and
 * native-control calls to PlaybackController remain unaffected. The dispatcher
 * does not own MediaRuntime; its owner must destroy it before runtime teardown.
 */

import {
  PLAYBACK_ACTION_BY_INPUT_ACTION,
  VOLUME_STEP,
} from "../../shared/input/actions.js";
import { InputActions } from "../../shared/input/types.js";

/** Executes canonical input actions against one MediaRuntime and UI host. */
export default class InputActionDispatcher {
  constructor({
    mediaRuntime,
    mediaActionFeedback = null,
    onTogglePopup,
    onOpenPreferences,
  } = {}) {
    if (!mediaRuntime)
      throw new TypeError("InputActionDispatcher requires MediaRuntime");

    this.mediaRuntime = mediaRuntime;
    this.mediaActionFeedback = mediaActionFeedback;
    this.onTogglePopup = onTogglePopup;
    this.onOpenPreferences = onOpenPreferences;
  }

  execute(inputAction) {
    if (!this.mediaRuntime) return;

    const player = this.mediaRuntime.playback.activePlayer;
    const feedbackContext = this.mediaActionFeedback?.begin(
      inputAction,
      player,
    );
    let result;

    const playbackAction = PLAYBACK_ACTION_BY_INPUT_ACTION[inputAction];
    if (playbackAction)
      result = this.mediaRuntime.playback.execute(playbackAction, player);
    else {
      switch (inputAction) {
        case InputActions.VOLUME_UP:
          result = this.mediaRuntime.playback.increaseVolume(
            VOLUME_STEP,
            player,
          );
          break;
        case InputActions.VOLUME_DOWN:
          result = this.mediaRuntime.playback.decreaseVolume(
            VOLUME_STEP,
            player,
          );
          break;
        case InputActions.TOGGLE_POPUP:
          this.onTogglePopup?.();
          return;
        case InputActions.OPEN_PREFERENCES:
          this.onOpenPreferences?.();
          return;
        case InputActions.RAISE_APP:
          return this.mediaRuntime.playback.raise(player);
        case InputActions.QUIT_APP:
          return this.mediaRuntime.playback.quit(player);
        case InputActions.SWITCH_APP:
          return this.mediaRuntime.switchPlayer();
        default:
          return;
      }
    }

    if (!feedbackContext) return result;
    if (!result || typeof result.then !== "function") {
      this.mediaActionFeedback?.complete(feedbackContext, result);
      return result;
    }

    return result.then(
      (operationResult) => {
        this.mediaActionFeedback?.complete(feedbackContext, operationResult);
        return operationResult;
      },
      (error) => {
        this.mediaActionFeedback?.complete(feedbackContext, null);
        throw error;
      },
    );
  }

  destroy() {
    this.mediaRuntime = null;
    this.mediaActionFeedback = null;
    this.onTogglePopup = null;
    this.onOpenPreferences = null;
  }
}
