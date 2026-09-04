/**
 * @file actions.js
 * @module shared.input.actions
 *
 * Defines executable input actions, shortcut ownership, and visible pointer order.
 *
 * Keyboard and pointer inputs share executable action descriptors, while pointer
 * rows use an explicit value map so visual order never depends on persisted enum
 * indexes. Deprecated enum slots are intentionally absent from executable tables.
 */

import { InputActions } from "./types.js";
import { PlaybackControlActions } from "../playback/controls.js";
import { SettingsKeys } from "../settings/contract.js";

function createInputAction(id, action, shortcutKey, playbackAction = null) {
  return Object.freeze({ id, action, shortcutKey, playbackAction });
}

/** Executable actions in the same semantic order used by shortcut preferences. */
export const INPUT_ACTION_DEFINITIONS = Object.freeze([
  createInputAction(
    "toggle-shuffle",
    InputActions.TOGGLE_SHUFFLE,
    SettingsKeys.INTERACTIONS_SHORTCUT_TOGGLE_SHUFFLE,
    PlaybackControlActions.TOGGLE_SHUFFLE,
  ),
  createInputAction(
    "seek-backward",
    InputActions.SEEK_BACKWARD,
    SettingsKeys.INTERACTIONS_SHORTCUT_SEEK_BACKWARD,
    PlaybackControlActions.SEEK_BACKWARD,
  ),
  createInputAction(
    "previous-track",
    InputActions.PREVIOUS_TRACK,
    SettingsKeys.INTERACTIONS_SHORTCUT_PREVIOUS_TRACK,
    PlaybackControlActions.PREVIOUS,
  ),
  createInputAction(
    "play-pause",
    InputActions.PLAY_PAUSE,
    SettingsKeys.INTERACTIONS_SHORTCUT_PLAY_PAUSE,
    PlaybackControlActions.PLAY_PAUSE,
  ),
  createInputAction(
    "next-track",
    InputActions.NEXT_TRACK,
    SettingsKeys.INTERACTIONS_SHORTCUT_NEXT_TRACK,
    PlaybackControlActions.NEXT,
  ),
  createInputAction(
    "seek-forward",
    InputActions.SEEK_FORWARD,
    SettingsKeys.INTERACTIONS_SHORTCUT_SEEK_FORWARD,
    PlaybackControlActions.SEEK_FORWARD,
  ),
  createInputAction(
    "toggle-loop",
    InputActions.TOGGLE_LOOP,
    SettingsKeys.INTERACTIONS_SHORTCUT_TOGGLE_LOOP,
    PlaybackControlActions.TOGGLE_REPEAT,
  ),
  createInputAction(
    "volume-up",
    InputActions.VOLUME_UP,
    SettingsKeys.INTERACTIONS_SHORTCUT_VOLUME_UP,
  ),
  createInputAction(
    "volume-down",
    InputActions.VOLUME_DOWN,
    SettingsKeys.INTERACTIONS_SHORTCUT_VOLUME_DOWN,
  ),
  createInputAction(
    "toggle-popup",
    InputActions.TOGGLE_POPUP,
    SettingsKeys.INTERACTIONS_SHORTCUT_TOGGLE_POPUP,
  ),
  createInputAction(
    "open-preferences",
    InputActions.OPEN_PREFERENCES,
    SettingsKeys.INTERACTIONS_SHORTCUT_OPEN_PREFERENCES,
  ),
  createInputAction(
    "raise-app",
    InputActions.RAISE_APP,
    SettingsKeys.INTERACTIONS_SHORTCUT_RAISE_APP,
  ),
  createInputAction(
    "quit-app",
    InputActions.QUIT_APP,
    SettingsKeys.INTERACTIONS_SHORTCUT_QUIT_APP,
  ),
  createInputAction(
    "switch-app",
    InputActions.SWITCH_APP,
    SettingsKeys.INTERACTIONS_SHORTCUT_SWITCH_APP,
  ),
]);

/** Legacy schema nicks retained only so stored enum values remain readable. */
export const LEGACY_INPUT_ACTION_SCHEMA_NICKS = Object.freeze({
  [InputActions.RESERVED_15]: "RATE_DECREASE",
  [InputActions.RESERVED_16]: "RATE_INCREASE",
  [InputActions.RESERVED_17]: "RATE_RESET",
});

/** Pointer action values in their translated GtkStringList display order. */
export const MOUSE_ACTION_VALUES = Object.freeze([
  InputActions.NONE,
  ...INPUT_ACTION_DEFINITIONS.map(({ action }) => action),
]);

/** Pointer combo index by persisted enum value. */
export const MOUSE_ACTION_INDEX_BY_VALUE = Object.freeze(
  Object.fromEntries(
    MOUSE_ACTION_VALUES.map((action, index) => [action, index]),
  ),
);

/** Playback action IDs indexed by their persisted InputActions enum value. */
export const PLAYBACK_ACTION_BY_INPUT_ACTION = Object.freeze(
  Object.fromEntries(
    INPUT_ACTION_DEFINITIONS.filter(({ playbackAction }) => playbackAction).map(
      ({ action, playbackAction }) => [action, playbackAction],
    ),
  ),
);

/** Shortcut GSettings keys derived from executable definitions. */
export const KEYBOARD_SHORTCUT_KEYS = Object.freeze(
  INPUT_ACTION_DEFINITIONS.map(({ shortcutKey }) => shortcutKey),
);

/** Volume delta applied by volume input actions; 0.05 represents a 5% step. */
export const VOLUME_STEP = 0.05;
