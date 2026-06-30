/**
 * @file input.js
 * @module shared.enums.input
 *
 * Enum values for mouse, scroll, and keyboard actions supported by MediaShell.
 *
 * ExtensionController dispatches these values when global shortcuts or top bar
 * pointer gestures fire. The numeric values are schema enum values and must match the
 * combo model order used by preferences.
 */

export const InputActions = Object.freeze({
  NONE: 0,
  TOGGLE_SHUFFLE: 1,
  PREVIOUS_TRACK: 2,
  PLAY_PAUSE: 3,
  NEXT_TRACK: 4,
  TOGGLE_LOOP: 5,
  VOLUME_UP: 6,
  VOLUME_DOWN: 7,
  TOGGLE_POPUP: 8,
  OPEN_PREFERENCES: 9,
  RAISE_APP: 10,
  QUIT_APP: 11,
  SWITCH_APP: 12,
});
