/**
 * @file popup.js
 * @module shell.constants.popup
 *
 * Defines Shell-side layout and animation constants used only by popup components.
 *
 * These values cover popup padding, album-art presentation, and media app selector
 * reveal timing. Keep popup geometry and animation policy here when preferences
 * code must not import it.
 */

/** Horizontal padding contributed by the popup container when computing inner content width. */
export const POPUP_CONTAINER_PADDING = 16;

/** Album-art scale while playback is paused or stopped. */
export const POPUP_ALBUM_ART_PAUSED_SCALE = 0.85;

/** Duration of album-art playback-state scale transitions, in milliseconds. */
export const POPUP_ALBUM_ART_PLAYBACK_ANIMATION_DURATION_MS = 350;

/** Duration of the media app selector reveal animation, in milliseconds. */
export const POPUP_MEDIA_APP_SELECTOR_REVEAL_DURATION_MS = 180;

/**
 * Duration of row opacity transitions inside the popup media app selector,
 * in milliseconds.
 */
export const POPUP_MEDIA_APP_SELECTOR_ROW_ANIMATION_MS = 140;
