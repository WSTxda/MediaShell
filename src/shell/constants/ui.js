/**
 * @file ui.js
 * @module shell.constants.ui
 *
 * Defines Shell-side UI layout constants used by popup components.
 *
 * These measurements mirror fixed spacing in stylesheet.css and component
 * geometry calculations. Keep Shell-only layout values here when they should be
 * shared by multiple runtime actors but must not be imported by preferences.
 */

// --- Popup layout ---

/** Horizontal padding added by the popup container, used to compute content width */
export const POPUP_CONTAINER_PADDING = 16;

// --- Album art layout ---

/** Border width applied to the album art frame outline */
export const ALBUM_ART_OUTLINE_WIDTH = 1;
