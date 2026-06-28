/**
 * @file PreferenceBindings.js
 * @module prefs.bindings.PreferenceBindings
 *
 * Declares the mapping from preferences widgets to GSettings keys.
 *
 * Each entry names a GtkBuilder object ID, the setting key it controls, and the
 * widget property used for binding. PreferenceBinder consumes this table as the
 * source of truth for automatic settings synchronization.
 */

export const PREFERENCE_WIDGET_BINDINGS = Object.freeze([
    ["popup-width", "sp-popup-width", "value"],
    ["show-popup-album-art", "er-popup-album-art", "enable-expansion"],
    ["popup-album-art-corner-radius", "sp-popup-album-art-radius", "value"],
    ["show-popup-track-information", "er-popup-track-information", "enable-expansion"],
    ["show-popup-title", "sr-popup-show-title", "active"],
    ["show-popup-artist", "sr-popup-show-artist", "active"],
    ["show-popup-album", "sr-popup-show-album", "active"],
    ["show-popup-progress-bar", "sr-popup-show-progress-bar", "active"],
    ["popup-scroll-track-information", "sw-popup-scroll-track-information", "active"],
    ["popup-scroll-speed", "sp-popup-scroll-speed", "value"],
    ["popup-scroll-pause-time", "sp-popup-scroll-pause", "value"],
    ["use-colored-popup-app-icon", "sr-popup-use-colored-app-icon", "active"],
    ["show-top-bar-track-information", "er-top-bar-track-information", "enable-expansion"],
    ["top-bar-track-information-width", "sp-top-bar-track-information-width", "value"],
    ["lock-top-bar-track-information-width", "sr-top-bar-lock-track-information-width", "active"],
    ["top-bar-scroll-track-information", "sw-top-bar-scroll-track-information", "active"],
    ["top-bar-scroll-speed", "sp-top-bar-scroll-speed", "value"],
    ["top-bar-scroll-pause-time", "sp-top-bar-scroll-pause", "value"],
    ["show-top-bar-playback-controls", "er-top-bar-playback-controls", "enable-expansion"],
    ["show-top-bar-play-pause", "sr-top-bar-show-play-pause", "active"],
    ["show-top-bar-next-track", "sr-top-bar-show-next-track", "active"],
    ["show-top-bar-previous-track", "sr-top-bar-show-previous-track", "active"],
    ["show-top-bar-app-icon", "er-top-bar-app-icon", "enable-expansion"],
    ["use-colored-top-bar-app-icon", "sr-top-bar-use-colored-app-icon", "active"],
    ["show-top-bar-visualizer", "er-top-bar-visualizer", "enable-expansion"],
    ["top-bar-visualizer-style", "cr-top-bar-visualizer-style", "selected"],
    ["top-bar-visualizer-speed", "sp-top-bar-visualizer-speed", "value"],
    ["top-bar-position", "cr-panel-top-bar-position", "selected"],
    ["top-bar-index", "sp-panel-top-bar-index", "value"],
    ["shortcut-play-pause", "sl-interactions-shortcut-play-pause", "accelerator"],
    ["shortcut-next-track", "sl-interactions-shortcut-next-track", "accelerator"],
    ["shortcut-previous-track", "sl-interactions-shortcut-previous-track", "accelerator"],
    ["shortcut-volume-up", "sl-interactions-shortcut-volume-up", "accelerator"],
    ["shortcut-volume-down", "sl-interactions-shortcut-volume-down", "accelerator"],
    ["shortcut-toggle-loop", "sl-interactions-shortcut-toggle-loop", "accelerator"],
    ["shortcut-toggle-shuffle", "sl-interactions-shortcut-toggle-shuffle", "accelerator"],
    ["shortcut-toggle-popup", "sl-interactions-shortcut-toggle-popup", "accelerator"],
    ["shortcut-raise-app", "sl-interactions-shortcut-raise-app", "accelerator"],
    ["shortcut-quit-app", "sl-interactions-shortcut-quit-app", "accelerator"],
    ["shortcut-open-preferences", "sl-interactions-shortcut-open-preferences", "accelerator"],
    ["shortcut-next-app", "sl-interactions-shortcut-next-app", "accelerator"],
    ["mouse-action-left", "cr-interactions-left-click", "selected"],
    ["mouse-action-middle", "cr-interactions-middle-click", "selected"],
    ["mouse-action-right", "cr-interactions-right-click", "selected"],
    ["mouse-action-double", "cr-interactions-double-click", "selected"],
    ["mouse-action-scroll-up", "cr-interactions-scroll-up", "selected"],
    ["mouse-action-scroll-down", "cr-interactions-scroll-down", "selected"],
    ["hide-system-media-controls", "sr-others-hide-system-media-controls", "active"],
    ["cache-album-art", "sr-others-cache-album-art", "active"],
]);
