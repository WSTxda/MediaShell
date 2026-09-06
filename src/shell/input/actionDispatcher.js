/**
 * @file actionDispatcher.js
 * @module shell.input.actionDispatcher
 *
 * Translates MediaShell input actions into runtime or application commands.
 *
 * Keyboard shortcuts and indicator pointer gestures share this dispatcher so
 * neither UI surface nor ExtensionController needs to duplicate playback,
 * volume, player-switching, popup, or preferences routing. The dispatcher emits
 * a generic input-action lifecycle that optional consumers can observe without
 * making input routing depend on any feedback feature.
 */

import {
  PLAYBACK_ACTION_BY_INPUT_ACTION,
  VOLUME_STEP,
} from "../../shared/input/actions.js";
import { InputActions } from "../../shared/input/types.js";
import { createLogger } from "../../shared/logging/logger.js";

const logger = createLogger("InputActionDispatcher");

export const InputActionPhases = Object.freeze({
  STARTED: "started",
  COMPLETED: "completed",
});

/** Executes canonical input actions against one MediaRuntime and UI host. */
export default class InputActionDispatcher {
  constructor({ mediaRuntime, onTogglePopup, onOpenPreferences } = {}) {
    if (!mediaRuntime)
      throw new TypeError("InputActionDispatcher requires MediaRuntime");

    this.mediaRuntime = mediaRuntime;
    this.onTogglePopup = onTogglePopup;
    this.onOpenPreferences = onOpenPreferences;
    this.actionListeners = new Map();
    this.nextActionListenerId = 1;
    this.nextActionId = 1;
  }

  onAction(callback) {
    if (typeof callback !== "function")
      throw new TypeError("Input action callback must be a function");

    const listenerId = this.nextActionListenerId++;
    this.actionListeners.set(listenerId, callback);
    return () => this.actionListeners.delete(listenerId);
  }

  emitAction(phase, action, result = null) {
    const event = Object.freeze({ phase, action, result });
    for (const callback of [...this.actionListeners.values()]) {
      try {
        callback(event);
      } catch (error) {
        logger.errorOnce(
          "action-listener",
          "Input action listener failed",
          error,
        );
      }
    }
  }

  createAction(inputAction, player, playbackAction = null) {
    return Object.freeze({
      id: this.nextActionId++,
      inputAction,
      playbackAction,
      player,
      origin: {},
    });
  }

  execute(inputAction) {
    if (!this.mediaRuntime) return;

    const player = this.mediaRuntime.playback.activePlayer;
    const playbackAction = PLAYBACK_ACTION_BY_INPUT_ACTION[inputAction] ?? null;
    const action = this.createAction(inputAction, player, playbackAction);
    this.emitAction(InputActionPhases.STARTED, action);

    let result;
    if (playbackAction)
      result = this.mediaRuntime.playback.execute(
        playbackAction,
        player,
        action.origin,
      );
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
          this.emitAction(InputActionPhases.COMPLETED, action);
          return;
        case InputActions.OPEN_PREFERENCES:
          this.onOpenPreferences?.();
          this.emitAction(InputActionPhases.COMPLETED, action);
          return;
        case InputActions.RAISE_APP:
          result = this.mediaRuntime.application.raise(player);
          break;
        case InputActions.QUIT_APP:
          result = this.mediaRuntime.playback.quit(player);
          break;
        case InputActions.SWITCH_APP:
          result = this.mediaRuntime.switchPlayer();
          break;
        default:
          this.emitAction(InputActionPhases.COMPLETED, action);
          return;
      }
    }

    if (!result || typeof result.then !== "function") {
      this.emitAction(InputActionPhases.COMPLETED, action, result);
      return result;
    }

    return result.then(
      (operationResult) => {
        this.emitAction(InputActionPhases.COMPLETED, action, operationResult);
        return operationResult;
      },
      (error) => {
        this.emitAction(InputActionPhases.COMPLETED, action, null);
        throw error;
      },
    );
  }

  destroy() {
    this.actionListeners.clear();
    this.mediaRuntime = null;
    this.onTogglePopup = null;
    this.onOpenPreferences = null;
  }
}
