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

/**
 * Runtime action descriptors shared by keyboard shortcuts and pointer gestures.
 *
 * The `id` is a stable developer-facing identifier, `action` is the value sent
 * to runtime dispatch, and `shortcutKey` points to the GSettings key that stores
 * the optional global accelerator. Keep entries in the same order used by the
 * preferences shortcut page.
 */
export const INPUT_ACTION_DEFINITIONS = Object.freeze([
    Object.freeze({ id: "play-pause", action: InputActions.PLAY_PAUSE, shortcutKey: "shortcut-play-pause" }),
    Object.freeze({ id: "next-track", action: InputActions.NEXT_TRACK, shortcutKey: "shortcut-next-track" }),
    Object.freeze({
        id: "previous-track",
        action: InputActions.PREVIOUS_TRACK,
        shortcutKey: "shortcut-previous-track",
    }),
    Object.freeze({ id: "volume-up", action: InputActions.VOLUME_UP, shortcutKey: "shortcut-volume-up" }),
    Object.freeze({ id: "volume-down", action: InputActions.VOLUME_DOWN, shortcutKey: "shortcut-volume-down" }),
    Object.freeze({ id: "toggle-loop", action: InputActions.TOGGLE_LOOP, shortcutKey: "shortcut-toggle-loop" }),
    Object.freeze({
        id: "toggle-shuffle",
        action: InputActions.TOGGLE_SHUFFLE,
        shortcutKey: "shortcut-toggle-shuffle",
    }),
    Object.freeze({ id: "toggle-popup", action: InputActions.TOGGLE_POPUP, shortcutKey: "shortcut-toggle-popup" }),
    Object.freeze({ id: "raise-app", action: InputActions.RAISE_APP, shortcutKey: "shortcut-raise-app" }),
    Object.freeze({ id: "quit-app", action: InputActions.QUIT_APP, shortcutKey: "shortcut-quit-app" }),
    Object.freeze({
        id: "open-preferences",
        action: InputActions.OPEN_PREFERENCES,
        shortcutKey: "shortcut-open-preferences",
    }),
    Object.freeze({ id: "next-app", action: InputActions.NEXT_APP, shortcutKey: "shortcut-next-app" }),
]);

/** Shortcut GSettings keys derived from INPUT_ACTION_DEFINITIONS for reset and validation flows. */
export const KEYBOARD_SHORTCUT_KEYS = Object.freeze(INPUT_ACTION_DEFINITIONS.map(({ shortcutKey }) => shortcutKey));

/** Volume delta applied by volume input actions; 0.05 represents a 5% step. */
export const VOLUME_STEP = 0.05;
