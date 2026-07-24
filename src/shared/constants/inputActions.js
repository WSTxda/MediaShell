/**
 * @file inputActions.js
 * @module shared.constants.inputActions
 *
 * Defines executable input actions and their optional global shortcut keys.
 *
 * The definitions map stable action IDs to InputActions enum values and the
 * GSettings key used when the action can be bound globally. Shell services and
 * preference controllers consume the same table so new actions remain consistent
 * across runtime execution and shortcut editing UI.
 */

import { InputActions } from "../enums/input.js";
import { SettingsKeys } from "./settings.js";

/**
 * Runtime action descriptors shared by keyboard shortcuts and pointer gestures.
 *
 * The `id` is a stable developer-facing identifier, `action` is the value sent
 * to runtime dispatch, and `shortcutKey` points to the GSettings key that stores
 * the optional global accelerator. Keep entries in the same order used by the
 * preferences shortcut page.
 */
export const INPUT_ACTION_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "toggle-shuffle",
    action: InputActions.TOGGLE_SHUFFLE,
    shortcutKey: SettingsKeys.INTERACTIONS_SHORTCUT_TOGGLE_SHUFFLE,
  }),
  Object.freeze({
    id: "previous-track",
    action: InputActions.PREVIOUS_TRACK,
    shortcutKey: SettingsKeys.INTERACTIONS_SHORTCUT_PREVIOUS_TRACK,
  }),
  Object.freeze({
    id: "play-pause",
    action: InputActions.PLAY_PAUSE,
    shortcutKey: SettingsKeys.INTERACTIONS_SHORTCUT_PLAY_PAUSE,
  }),
  Object.freeze({
    id: "next-track",
    action: InputActions.NEXT_TRACK,
    shortcutKey: SettingsKeys.INTERACTIONS_SHORTCUT_NEXT_TRACK,
  }),
  Object.freeze({
    id: "toggle-loop",
    action: InputActions.TOGGLE_LOOP,
    shortcutKey: SettingsKeys.INTERACTIONS_SHORTCUT_TOGGLE_LOOP,
  }),
  Object.freeze({
    id: "volume-up",
    action: InputActions.VOLUME_UP,
    shortcutKey: SettingsKeys.INTERACTIONS_SHORTCUT_VOLUME_UP,
  }),
  Object.freeze({
    id: "volume-down",
    action: InputActions.VOLUME_DOWN,
    shortcutKey: SettingsKeys.INTERACTIONS_SHORTCUT_VOLUME_DOWN,
  }),
  Object.freeze({
    id: "toggle-popup",
    action: InputActions.TOGGLE_POPUP,
    shortcutKey: SettingsKeys.INTERACTIONS_SHORTCUT_TOGGLE_POPUP,
  }),
  Object.freeze({
    id: "open-preferences",
    action: InputActions.OPEN_PREFERENCES,
    shortcutKey: SettingsKeys.INTERACTIONS_SHORTCUT_OPEN_PREFERENCES,
  }),
  Object.freeze({
    id: "raise-app",
    action: InputActions.RAISE_APP,
    shortcutKey: SettingsKeys.INTERACTIONS_SHORTCUT_RAISE_APP,
  }),
  Object.freeze({
    id: "quit-app",
    action: InputActions.QUIT_APP,
    shortcutKey: SettingsKeys.INTERACTIONS_SHORTCUT_QUIT_APP,
  }),
  Object.freeze({
    id: "switch-app",
    action: InputActions.SWITCH_APP,
    shortcutKey: SettingsKeys.INTERACTIONS_SHORTCUT_SWITCH_APP,
  }),
]);

/** Shortcut GSettings keys derived from INPUT_ACTION_DEFINITIONS for reset and validation flows. */
export const KEYBOARD_SHORTCUT_KEYS = Object.freeze(
  INPUT_ACTION_DEFINITIONS.map(({ shortcutKey }) => shortcutKey),
);

/** Volume delta applied by volume input actions; 0.05 represents a 5% step. */
export const VOLUME_STEP = 0.05;
