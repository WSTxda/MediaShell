/**
 * @file settings.js
 * @module shared.constants.settings
 *
 * Defines canonical GSettings keys, defaults, and bounds.
 *
 * The XML schema remains the persisted contract. Runtime and preferences modules
 * import the keys below so JavaScript never re-types a schema key under a second
 * name, while shared ranges and defaults keep repair behavior aligned.
 */

/**
 * Canonical GSettings keys used by Shell and Preferences code.
 *
 * Property names are developer-facing identifiers; values are the stable names
 * persisted by the XML schema and must never be repurposed.
 */
export const SettingsKeys = Object.freeze({
  POPUP_WIDTH: "popup-width",
  POPUP_ALBUM_ART_SHOW: "popup-album-art-show",
  POPUP_ALBUM_ART_CORNER_RADIUS: "popup-album-art-corner-radius",
  POPUP_TRACK_INFORMATION_SHOW: "popup-track-information-show",
  POPUP_TRACK_INFORMATION_CONTENT: "popup-track-information-content",
  POPUP_PROGRESS_BAR_SHOW: "popup-progress-bar-show",
  POPUP_PLAYBACK_CONTROLS_SHOW: "popup-playback-controls-show",
  POPUP_PLAYBACK_CONTROLS_SHUFFLE_SHOW: "popup-playback-controls-shuffle-show",
  POPUP_PLAYBACK_CONTROLS_SEEK_BACKWARD_SHOW:
    "popup-playback-controls-seek-backward-show",
  POPUP_PLAYBACK_CONTROLS_PREVIOUS_TRACK_SHOW:
    "popup-playback-controls-previous-track-show",
  POPUP_PLAYBACK_CONTROLS_PLAY_PAUSE_SHOW:
    "popup-playback-controls-play-pause-show",
  POPUP_PLAYBACK_CONTROLS_NEXT_TRACK_SHOW:
    "popup-playback-controls-next-track-show",
  POPUP_PLAYBACK_CONTROLS_SEEK_FORWARD_SHOW:
    "popup-playback-controls-seek-forward-show",
  POPUP_PLAYBACK_CONTROLS_REPEAT_SHOW: "popup-playback-controls-repeat-show",
  POPUP_PLAYBACK_CONTROLS_SPEED_SHOW: "popup-playback-controls-speed-show",
  POPUP_TRACK_INFORMATION_SCROLL_ENABLED:
    "popup-track-information-scroll-enabled",
  POPUP_TRACK_INFORMATION_SCROLL_SPEED: "popup-track-information-scroll-speed",
  POPUP_TRACK_INFORMATION_SCROLL_PAUSE_TIME:
    "popup-track-information-scroll-pause-time",
  POPUP_MEDIA_APP_ICON_USE_COLOR: "popup-media-app-icon-use-color",

  // Historical schema IDs remain the persisted track-information width contract.
  TOP_BAR_TRACK_INFORMATION_WIDTH: "top-bar-track-information-width",
  TOP_BAR_TRACK_INFORMATION_WIDTH_LOCK: "top-bar-track-information-width-lock",
  TOP_BAR_TRACK_INFORMATION_SHOW: "top-bar-track-information-show",
  TOP_BAR_TRACK_INFORMATION_SCROLL_ENABLED:
    "top-bar-track-information-scroll-enabled",
  TOP_BAR_TRACK_INFORMATION_SCROLL_SPEED:
    "top-bar-track-information-scroll-speed",
  TOP_BAR_TRACK_INFORMATION_SCROLL_PAUSE_TIME:
    "top-bar-track-information-scroll-pause-time",
  TOP_BAR_TRACK_INFORMATION_CONTENT: "top-bar-track-information-content",
  TOP_BAR_MEDIA_APP_ICON_SHOW: "top-bar-media-app-icon-show",
  TOP_BAR_MEDIA_APP_ICON_USE_COLOR: "top-bar-media-app-icon-use-color",
  TOP_BAR_ALBUM_ART_SHOW: "top-bar-album-art-show",
  TOP_BAR_ALBUM_ART_SIZE_PERCENT: "top-bar-album-art-size-percent",
  TOP_BAR_ALBUM_ART_CORNER_RADIUS_PERCENT:
    "top-bar-album-art-corner-radius-percent",
  TOP_BAR_VISUALIZER_SHOW: "top-bar-visualizer-show",
  TOP_BAR_VISUALIZER_STYLE: "top-bar-visualizer-style",
  TOP_BAR_VISUALIZER_SPEED: "top-bar-visualizer-speed",
  TOP_BAR_PLAYBACK_CONTROLS_SHOW: "top-bar-playback-controls-show",
  TOP_BAR_PLAYBACK_CONTROLS_SHUFFLE_SHOW:
    "top-bar-playback-controls-shuffle-show",
  TOP_BAR_PLAYBACK_CONTROLS_SEEK_BACKWARD_SHOW:
    "top-bar-playback-controls-seek-backward-show",
  TOP_BAR_PLAYBACK_CONTROLS_PREVIOUS_TRACK_SHOW:
    "top-bar-playback-controls-previous-track-show",
  TOP_BAR_PLAYBACK_CONTROLS_PLAY_PAUSE_SHOW:
    "top-bar-playback-controls-play-pause-show",
  TOP_BAR_PLAYBACK_CONTROLS_NEXT_TRACK_SHOW:
    "top-bar-playback-controls-next-track-show",
  TOP_BAR_PLAYBACK_CONTROLS_SEEK_FORWARD_SHOW:
    "top-bar-playback-controls-seek-forward-show",
  TOP_BAR_PLAYBACK_CONTROLS_REPEAT_SHOW:
    "top-bar-playback-controls-repeat-show",
  TOP_BAR_ELEMENT_ORDER: "top-bar-element-order",

  PANEL_POSITION: "panel-position",
  PANEL_INDEX: "panel-index",

  INTERACTIONS_SHORTCUT_TOGGLE_SHUFFLE: "interactions-shortcut-toggle-shuffle",
  INTERACTIONS_SHORTCUT_SEEK_BACKWARD: "interactions-shortcut-seek-backward",
  INTERACTIONS_SHORTCUT_PREVIOUS_TRACK: "interactions-shortcut-previous-track",
  INTERACTIONS_SHORTCUT_PLAY_PAUSE: "interactions-shortcut-play-pause",
  INTERACTIONS_SHORTCUT_NEXT_TRACK: "interactions-shortcut-next-track",
  INTERACTIONS_SHORTCUT_SEEK_FORWARD: "interactions-shortcut-seek-forward",
  INTERACTIONS_SHORTCUT_TOGGLE_LOOP: "interactions-shortcut-toggle-loop",
  INTERACTIONS_SHORTCUT_VOLUME_UP: "interactions-shortcut-volume-up",
  INTERACTIONS_SHORTCUT_VOLUME_DOWN: "interactions-shortcut-volume-down",
  INTERACTIONS_SHORTCUT_TOGGLE_POPUP: "interactions-shortcut-toggle-popup",
  INTERACTIONS_SHORTCUT_OPEN_PREFERENCES:
    "interactions-shortcut-open-preferences",
  INTERACTIONS_SHORTCUT_RAISE_APP: "interactions-shortcut-raise-app",
  INTERACTIONS_SHORTCUT_QUIT_APP: "interactions-shortcut-quit-app",
  INTERACTIONS_SHORTCUT_SWITCH_APP: "interactions-shortcut-switch-app",
  INTERACTIONS_MOUSE_ACTION_LEFT: "interactions-mouse-action-left",
  INTERACTIONS_MOUSE_ACTION_MIDDLE: "interactions-mouse-action-middle",
  INTERACTIONS_MOUSE_ACTION_RIGHT: "interactions-mouse-action-right",
  INTERACTIONS_MOUSE_ACTION_DOUBLE: "interactions-mouse-action-double",
  INTERACTIONS_MOUSE_ACTION_SCROLL_UP: "interactions-mouse-action-scroll-up",
  INTERACTIONS_MOUSE_ACTION_SCROLL_DOWN:
    "interactions-mouse-action-scroll-down",

  GNOME_SHELL_HIDE_MEDIA_CONTROLS: "gnome-shell-hide-media-controls",
  ALBUM_ART_CACHE_ENABLED: "album-art-cache-enabled",
  BLOCKED_APPS: "blocked-apps",
});

// --- Top bar settings ---

/**
 * Default order for top bar elements when the order setting is unset or repaired.
 *
 * The order mirrors the initial user experience: app identity and album art first,
 * followed by track information, optional activity feedback, and compact controls.
 */
export const TOP_BAR_ELEMENT_ORDER_DEFAULT = Object.freeze([
  "MEDIA_APP_ICON",
  "ALBUM_ART",
  "TRACK_INFORMATION",
  "VISUALIZER",
  "PLAYBACK_CONTROLS",
]);

/** Default ordered content for top bar track information. */
export const TOP_BAR_TRACK_INFORMATION_CONTENT_DEFAULT = Object.freeze([
  "TITLE",
  "•",
  "ARTIST",
]);

/** Constraints for top bar track-information width, in pixels. */
export const TOP_BAR_TRACK_INFORMATION_WIDTH_CONSTRAINTS = Object.freeze({
  MIN: 0,
  MAX: 1000,
  DEFAULT: 200,
});

/** Constraints for top-bar album-art size, relative to panel content height. */
export const TOP_BAR_ALBUM_ART_SIZE_PERCENT_CONSTRAINTS = Object.freeze({
  MIN: 60,
  MAX: 100,
  DEFAULT: 65,
});

/** Constraints for top-bar album-art corner radius, relative to a circle. */
export const TOP_BAR_ALBUM_ART_CORNER_RADIUS_PERCENT_CONSTRAINTS =
  Object.freeze({
    MIN: 0,
    MAX: 100,
    DEFAULT: 40,
  });

/** Constraints for popup and top bar track-information scroll speed. */
export const TRACK_INFORMATION_SCROLL_SPEED_CONSTRAINTS = Object.freeze({
  MIN: 1,
  MAX: 10,
  DEFAULT: 4,
});

/** Constraints for the optional top bar visualizer animation speed. */
export const TOP_BAR_VISUALIZER_SPEED_CONSTRAINTS = Object.freeze({
  MIN: 1,
  MAX: 8,
  DEFAULT: 4,
});

/** Constraints for the pause between track-information scroll cycles, in seconds. */
export const TRACK_INFORMATION_SCROLL_PAUSE_SECONDS_CONSTRAINTS = Object.freeze(
  {
    MIN: 0,
    MAX: 10,
    DEFAULT: 1,
  },
);

// --- Popup settings ---

/** Constraints for popup content width, in pixels. */
export const POPUP_WIDTH_CONSTRAINTS = Object.freeze({
  MIN: 250,
  MAX: 500,
  DEFAULT: 250,
});

/** Constraints for popup album-art corner radius, in pixels. */
export const POPUP_ALBUM_ART_CORNER_RADIUS_CONSTRAINTS = Object.freeze({
  MIN: 0,
  MAX: 50,
  DEFAULT: 20,
});

/** Default ordered content for popup track information. */
export const POPUP_TRACK_INFORMATION_CONTENT_DEFAULT = Object.freeze([
  "TITLE",
  "ARTIST",
  "ALBUM",
]);

// --- Panel placement settings ---

/** Constraints for the MediaShell button insertion index in Main.panel. */
export const PANEL_INDEX_CONSTRAINTS = Object.freeze({
  MIN: 0,
  MAX: 100,
  DEFAULT: 0,
});

/**
 * Numeric GSettings contracts keyed by their stable schema names.
 *
 * Runtime transforms keep importing the descriptive constants above. Repository
 * validation consumes this map to compare every shared bound and default with
 * the parsed XML schema instead of searching source text.
 */
export const NUMERIC_SETTING_CONSTRAINTS = Object.freeze({
  [SettingsKeys.POPUP_WIDTH]: POPUP_WIDTH_CONSTRAINTS,
  [SettingsKeys.POPUP_ALBUM_ART_CORNER_RADIUS]:
    POPUP_ALBUM_ART_CORNER_RADIUS_CONSTRAINTS,
  [SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_SPEED]:
    TRACK_INFORMATION_SCROLL_SPEED_CONSTRAINTS,
  [SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_PAUSE_TIME]:
    TRACK_INFORMATION_SCROLL_PAUSE_SECONDS_CONSTRAINTS,
  [SettingsKeys.TOP_BAR_TRACK_INFORMATION_WIDTH]:
    TOP_BAR_TRACK_INFORMATION_WIDTH_CONSTRAINTS,
  [SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_SPEED]:
    TRACK_INFORMATION_SCROLL_SPEED_CONSTRAINTS,
  [SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_PAUSE_TIME]:
    TRACK_INFORMATION_SCROLL_PAUSE_SECONDS_CONSTRAINTS,
  [SettingsKeys.TOP_BAR_ALBUM_ART_SIZE_PERCENT]:
    TOP_BAR_ALBUM_ART_SIZE_PERCENT_CONSTRAINTS,
  [SettingsKeys.TOP_BAR_ALBUM_ART_CORNER_RADIUS_PERCENT]:
    TOP_BAR_ALBUM_ART_CORNER_RADIUS_PERCENT_CONSTRAINTS,
  [SettingsKeys.TOP_BAR_VISUALIZER_SPEED]: TOP_BAR_VISUALIZER_SPEED_CONSTRAINTS,
  [SettingsKeys.PANEL_INDEX]: PANEL_INDEX_CONSTRAINTS,
});

/** Ordered string-list defaults that must stay identical to the XML schema. */
export const ORDERED_SETTING_DEFAULTS = Object.freeze({
  [SettingsKeys.POPUP_TRACK_INFORMATION_CONTENT]:
    POPUP_TRACK_INFORMATION_CONTENT_DEFAULT,
  [SettingsKeys.TOP_BAR_TRACK_INFORMATION_CONTENT]:
    TOP_BAR_TRACK_INFORMATION_CONTENT_DEFAULT,
  [SettingsKeys.TOP_BAR_ELEMENT_ORDER]: TOP_BAR_ELEMENT_ORDER_DEFAULT,
});
