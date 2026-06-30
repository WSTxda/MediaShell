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

const POPUP_BINDINGS = Object.freeze([
  ["popup-width", "sp-popup-width", "value"],
  ["popup-album-art-show", "er-popup-album-art", "enable-expansion"],
  [
    "popup-album-art-corner-radius",
    "sp-popup-album-art-corner-radius",
    "value",
  ],
  [
    "popup-track-information-show",
    "er-popup-track-information",
    "enable-expansion",
  ],
  ["popup-progress-bar-show", "sr-popup-progress-bar-show", "active"],
  [
    "popup-track-information-scroll-enabled",
    "sw-popup-track-information-scroll-enabled",
    "active",
  ],
  [
    "popup-track-information-scroll-speed",
    "sp-popup-track-information-scroll-speed",
    "value",
  ],
  [
    "popup-track-information-scroll-pause-time",
    "sp-popup-track-information-scroll-pause-time",
    "value",
  ],
  ["popup-app-icon-use-color", "sr-popup-app-icon-use-color", "active"],
]);

const TOP_BAR_BINDINGS = Object.freeze([
  [
    "top-bar-track-information-show",
    "er-top-bar-track-information",
    "enable-expansion",
  ],
  [
    "top-bar-track-information-width",
    "sp-top-bar-track-information-width",
    "value",
  ],
  [
    "top-bar-track-information-width-lock",
    "sr-top-bar-track-information-width-lock",
    "active",
  ],
  [
    "top-bar-track-information-scroll-enabled",
    "sw-top-bar-track-information-scroll-enabled",
    "active",
  ],
  [
    "top-bar-track-information-scroll-speed",
    "sp-top-bar-track-information-scroll-speed",
    "value",
  ],
  [
    "top-bar-track-information-scroll-pause-time",
    "sp-top-bar-track-information-scroll-pause-time",
    "value",
  ],
  [
    "top-bar-playback-controls-show",
    "er-top-bar-playback-controls",
    "enable-expansion",
  ],
  [
    "top-bar-playback-controls-repeat-show",
    "sr-top-bar-playback-controls-repeat-show",
    "active",
  ],
  [
    "top-bar-playback-controls-previous-track-show",
    "sr-top-bar-playback-controls-previous-track-show",
    "active",
  ],
  [
    "top-bar-playback-controls-play-pause-show",
    "sr-top-bar-playback-controls-play-pause-show",
    "active",
  ],
  [
    "top-bar-playback-controls-next-track-show",
    "sr-top-bar-playback-controls-next-track-show",
    "active",
  ],
  [
    "top-bar-playback-controls-shuffle-show",
    "sr-top-bar-playback-controls-shuffle-show",
    "active",
  ],
  ["top-bar-app-icon-show", "er-top-bar-app-icon", "enable-expansion"],
  ["top-bar-app-icon-use-color", "sr-top-bar-app-icon-use-color", "active"],
  ["top-bar-visualizer-show", "er-top-bar-visualizer", "enable-expansion"],
  ["top-bar-visualizer-style", "cr-top-bar-visualizer-style", "selected"],
  ["top-bar-visualizer-speed", "sp-top-bar-visualizer-speed", "value"],
]);

const PANEL_BINDINGS = Object.freeze([
  ["panel-position", "cr-panel-position", "selected"],
  ["panel-index", "sp-panel-index", "value"],
]);

const INTERACTIONS_BINDINGS = Object.freeze([
  [
    "interactions-shortcut-play-pause",
    "sl-interactions-shortcut-play-pause",
    "accelerator",
  ],
  [
    "interactions-shortcut-next-track",
    "sl-interactions-shortcut-next-track",
    "accelerator",
  ],
  [
    "interactions-shortcut-previous-track",
    "sl-interactions-shortcut-previous-track",
    "accelerator",
  ],
  [
    "interactions-shortcut-volume-up",
    "sl-interactions-shortcut-volume-up",
    "accelerator",
  ],
  [
    "interactions-shortcut-volume-down",
    "sl-interactions-shortcut-volume-down",
    "accelerator",
  ],
  [
    "interactions-shortcut-toggle-loop",
    "sl-interactions-shortcut-toggle-loop",
    "accelerator",
  ],
  [
    "interactions-shortcut-toggle-shuffle",
    "sl-interactions-shortcut-toggle-shuffle",
    "accelerator",
  ],
  [
    "interactions-shortcut-toggle-popup",
    "sl-interactions-shortcut-toggle-popup",
    "accelerator",
  ],
  [
    "interactions-shortcut-raise-app",
    "sl-interactions-shortcut-raise-app",
    "accelerator",
  ],
  [
    "interactions-shortcut-quit-app",
    "sl-interactions-shortcut-quit-app",
    "accelerator",
  ],
  [
    "interactions-shortcut-open-preferences",
    "sl-interactions-shortcut-open-preferences",
    "accelerator",
  ],
  [
    "interactions-shortcut-next-app",
    "sl-interactions-shortcut-next-app",
    "accelerator",
  ],
  ["interactions-mouse-action-left", "cr-interactions-left-click", "selected"],
  [
    "interactions-mouse-action-middle",
    "cr-interactions-middle-click",
    "selected",
  ],
  [
    "interactions-mouse-action-right",
    "cr-interactions-right-click",
    "selected",
  ],
  [
    "interactions-mouse-action-double",
    "cr-interactions-double-click",
    "selected",
  ],
  [
    "interactions-mouse-action-scroll-up",
    "cr-interactions-scroll-up",
    "selected",
  ],
  [
    "interactions-mouse-action-scroll-down",
    "cr-interactions-scroll-down",
    "selected",
  ],
]);

const OTHERS_BINDINGS = Object.freeze([
  [
    "gnome-shell-hide-media-controls",
    "sr-gnome-shell-hide-media-controls",
    "active",
  ],
  ["album-art-cache-enabled", "sr-album-art-cache-enabled", "active"],
]);

export const PREFERENCE_WIDGET_BINDINGS = Object.freeze([
  ...POPUP_BINDINGS,
  ...TOP_BAR_BINDINGS,
  ...PANEL_BINDINGS,
  ...INTERACTIONS_BINDINGS,
  ...OTHERS_BINDINGS,
]);
