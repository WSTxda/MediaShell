/**
 * @file input.js
 * @module shared.enums.input
 *
 * Enum values for mouse, scroll, and keyboard actions supported by MediaShell.
 *
 * Values are persisted by GSettings. Existing executable values are stable, and
 * deprecated values 15–17 remain reserved so old settings are never repurposed.
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
  SEEK_BACKWARD: 13,
  SEEK_FORWARD: 14,
  RESERVED_15: 15,
  RESERVED_16: 16,
  RESERVED_17: 17,
});
