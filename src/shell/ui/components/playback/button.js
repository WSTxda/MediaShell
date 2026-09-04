/**
 * @file button.js
 * @module shell.ui.components.playback.button
 *
 * Applies shared interaction and accessibility state to playback buttons.
 *
 * Popup and top bar retain separate actors and visual opacity policies, while
 * focusability, hover tracking, toggle state, and accessible naming stay
 * identical for the same canonical control state.
 */

import { resolvePlaybackControlAccessibleName } from "../../../media/playback/accessibility.js";

/**
 * Applies canonical interaction and accessibility state to a Shell button.
 *
 * @param {object} button - St.Button-like actor.
 * @param {object} player - Normalized player state.
 * @param {object} controlState - Result from resolvePlaybackControlState().
 * @param {(message: string) => string} gettext - Translation function.
 */
export function updatePlaybackControlButton(
  button,
  player,
  controlState,
  gettext,
) {
  button.set_accessible_name(
    resolvePlaybackControlAccessibleName(player, controlState, gettext),
  );
  button.trackHover = controlState.isReactive;
  button.reactive = controlState.isReactive;
  button.canFocus = controlState.isReactive;
  button.checked = controlState.isActive;
}
