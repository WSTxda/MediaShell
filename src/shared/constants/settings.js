/**
 * @file settings.js
 * @module shared.constants.settings
 *
 * Defines shared setting defaults, bounds, and filesystem names.
 *
 * These constants mirror the GSettings schema contract without replacing it.
 * Keep user-visible schema keys in SettingsSpec and the XML schema; keep numeric
 * ranges and default structures here when runtime and preferences both need them.
 */

// --- Filesystem settings ---

/** Directory name used under the user cache directory for persisted album-art files. */
export const ALBUM_ART_CACHE_DIRECTORY_NAME = "mediashell@wstxda.github.com";

// --- Top bar settings ---

/**
 * Default order for top-bar elements when the order setting is unset or repaired.
 *
 * The order mirrors the initial user experience: app identity first, metadata
 * next, then optional activity feedback and compact transport controls.
 */
export const TOP_BAR_ELEMENT_ORDER_DEFAULT = Object.freeze([
    "APP_ICON",
    "TRACK_INFORMATION",
    "VISUALIZER",
    "PLAYBACK_CONTROLS",
]);

/** Bounds and default width for the top-bar track information area, in pixels. */
export const TOP_BAR_TRACK_INFORMATION_WIDTH = Object.freeze({
    MIN: 0,
    MAX: 1000,
    DEFAULT: 200,
});

/** Bounds and default value for scrolling track-information speed controls. */
export const TEXT_SCROLL_SPEED = Object.freeze({
    MIN: 1,
    MAX: 10,
    DEFAULT: 4,
});

/** Bounds and default value for the optional top-bar visualizer animation speed. */
export const TOP_BAR_VISUALIZER_SPEED = Object.freeze({
    MIN: 1,
    MAX: 8,
    DEFAULT: 4,
});

/** Bounds and default pause between text-scroll cycles, in seconds. */
export const TEXT_SCROLL_PAUSE_SECONDS = Object.freeze({
    MIN: 0,
    MAX: 10,
    DEFAULT: 0,
});

// --- Popup settings ---

/** Bounds and default popup content width, in pixels. */
export const POPUP_WIDTH = Object.freeze({
    MIN: 250,
    MAX: 500,
    DEFAULT: 250,
});

/** Bounds and default corner radius for popup album art, in pixels. */
export const POPUP_ALBUM_ART_CORNER_RADIUS = Object.freeze({
    MIN: 0,
    MAX: 50,
    DEFAULT: 20,
});

// --- Panel placement settings ---

/** Bounds and default insertion index for the MediaShell top bar button in Main.panel. */
export const TOP_BAR_INDEX = Object.freeze({
    MIN: 0,
    MAX: 100,
    DEFAULT: 0,
});
