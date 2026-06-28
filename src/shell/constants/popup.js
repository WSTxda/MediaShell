/**
 * @file popup.js
 * @module shell.constants.popup
 *
 * Defines Shell-side layout and animation constants used only by popup components.
 *
 * These values cover popup padding, album-art outlines, and app-selector reveal
 * timing. Keep popup geometry here when more than one popup component needs the
 * same value and preferences code must not import it.
 */

/** Horizontal padding contributed by the popup container when computing inner content width. */
export const POPUP_CONTAINER_PADDING = 16;

/** Border width applied to the album-art frame outline. */
export const ALBUM_ART_OUTLINE_WIDTH = 1;

/** Duration of the app-selector reveal animation, in milliseconds. */
export const POPUP_APP_SELECTOR_REVEAL_DURATION_MS = 180;

/** Duration of row opacity transitions inside the popup app selector, in milliseconds. */
export const POPUP_APP_SELECTOR_ROW_ANIMATION_MS = 140;
