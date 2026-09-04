/**
 * @file presentation.js
 * @module shell.ui.popup.presentation
 *
 * Defines Shell-side layout and animation constants used only by popup components.
 *
 * These values cover popup padding, artwork presentation, and player-selector
 * reveal timing. Keep popup geometry and animation policy here when preferences
 * code must not import it.
 */

/** Horizontal padding contributed by the popup container when computing inner content width. */
export const POPUP_CONTAINER_PADDING = 16;

/** Horizontal inset applied to the compact popup volume row. */
export const POPUP_VOLUME_CONTROL_HORIZONTAL_INSET = 4;

/** Artwork scale while playback is paused or stopped. */
export const POPUP_ALBUM_ART_PAUSED_SCALE = 0.85;

/** Duration of artwork playback-state scale transitions, in milliseconds. */
export const POPUP_ALBUM_ART_PLAYBACK_ANIMATION_DURATION_MS = 350;

/** Duration of the player selector reveal animation, in milliseconds. */
export const POPUP_PLAYER_SELECTOR_REVEAL_DURATION_MS = 180;

/**
 * Duration of row opacity transitions inside the popup player selector,
 * in milliseconds.
 */
export const POPUP_PLAYER_SELECTOR_ROW_ANIMATION_MS = 140;
