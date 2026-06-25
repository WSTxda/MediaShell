/**
 * @file input.js
 * @module shared.enums.input
 *
 * Enum values for mouse, scroll, and keyboard actions supported by MediaShell.
 *
 * ExtensionController dispatches these values when global shortcuts or top-bar
 * pointer gestures fire. The numeric values are also covered by migration tests
 * because historical enum nicks must preserve their semantic meaning.
 */
export const InputActions = Object.freeze({
    NONE: 0,
    PLAY_PAUSE: 1,
    NEXT_TRACK: 2,
    PREVIOUS_TRACK: 3,
    VOLUME_UP: 4,
    VOLUME_DOWN: 5,
    TOGGLE_LOOP: 6,
    TOGGLE_SHUFFLE: 7,
    TOGGLE_POPUP: 8,
    RAISE_APP: 9,
    QUIT_APP: 10,
    OPEN_PREFERENCES: 11,
    NEXT_APP: 12,
});
