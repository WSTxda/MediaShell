/**
 * @file SettingsSpec.js
 * @module shell.settings.SettingsSpec
 *
 * Declares runtime metadata for every MediaShell GSettings key.
 *
 * SettingsStore uses the spec to validate key types, expose transformed values,
 * and decide which runtime action a key change requires. The file contains spec
 * factory helpers only; domain behavior belongs in controllers and services.
 */

import {
  POPUP_ALBUM_ART_CORNER_RADIUS,
  POPUP_TRACK_INFORMATION_CONTENT_DEFAULT,
  POPUP_WIDTH,
  TEXT_SCROLL_PAUSE_SECONDS,
  TEXT_SCROLL_SPEED,
  TOP_BAR_ELEMENT_ORDER_DEFAULT,
  TOP_BAR_TRACK_INFORMATION_CONTENT_DEFAULT,
  PANEL_INDEX,
  TOP_BAR_TRACK_INFORMATION_WIDTH,
  TOP_BAR_VISUALIZER_SPEED,
} from "../../shared/constants/settings.js";
import { InputActions } from "../../shared/enums/input.js";
import { SettingsAction } from "../../shared/enums/settings.js";
import { PanelPositions } from "../../shared/enums/panel.js";
import { VisualizerStyles } from "../../shared/enums/visualizer.js";
import { WidgetFlags } from "../../shared/enums/widget.js";
import {
  enumValueByIndex,
  normalizeOrderedValues,
  normalizeUniqueStrings,
} from "../../shared/utils/format.js";

/**
 * Creates a transform that clamps numeric settings to their supported bounds.
 *
 * SettingsStore calls these transforms after reading raw GSettings values. Keeping
 * bounds in SettingsSpec prevents invalid schema or user-edited values from
 * reaching UI components.
 *
 * @param {{MIN: number, MAX: number, DEFAULT: number}} bounds - Supported range and fallback.
 * @returns {(value: unknown) => number} Numeric settings transform.
 */
function createNumericConstraint({ MIN, MAX, DEFAULT }) {
  return (value) =>
    Math.min(MAX, Math.max(MIN, Number.isFinite(value) ? value : DEFAULT));
}

/**
 * Creates a transform for settings stored in seconds but consumed in milliseconds.
 *
 * @param {{MIN: number, MAX: number, DEFAULT: number}} bounds - Supported seconds range.
 * @returns {(value: unknown) => number} Millisecond settings transform.
 */
function createSecondsToMillisecondsTransform(bounds) {
  const constrainValue = createNumericConstraint(bounds);
  return (value) => constrainValue(value) * 1000;
}

function normalizeTrackInformationContent(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
}

export const SETTINGS_SPEC = Object.freeze({
  // Popup
  "popup-width": {
    property: "popupWidth",
    read: "get_uint",
    transform: createNumericConstraint(POPUP_WIDTH),
    impact:
      WidgetFlags.POPUP_ALBUM_ART |
      WidgetFlags.POPUP_TRACK_INFORMATION |
      WidgetFlags.POPUP_PROGRESS_BAR,
  },
  "popup-album-art-show": {
    property: "popupAlbumArtShow",
    read: "get_boolean",
    impact:
      WidgetFlags.POPUP_ALBUM_ART |
      WidgetFlags.POPUP_TRACK_INFORMATION |
      WidgetFlags.POPUP_PROGRESS_BAR,
  },
  "popup-album-art-corner-radius": {
    property: "popupAlbumArtCornerRadius",
    read: "get_uint",
    transform: createNumericConstraint(POPUP_ALBUM_ART_CORNER_RADIUS),
    impact: WidgetFlags.POPUP_ALBUM_ART,
  },
  "popup-track-information-show": {
    property: "popupTrackInformationShow",
    read: "get_boolean",
    impact: WidgetFlags.POPUP_TRACK_INFORMATION,
  },
  "popup-track-information-content": {
    property: "popupTrackInformationContent",
    read: "get_strv",
    transform: (value) =>
      normalizeTrackInformationContent(
        value,
        POPUP_TRACK_INFORMATION_CONTENT_DEFAULT,
      ),
    impact: WidgetFlags.POPUP_TRACK_INFORMATION,
  },
  "popup-progress-bar-show": {
    property: "popupProgressBarShow",
    read: "get_boolean",
    impact: WidgetFlags.POPUP_PROGRESS_BAR,
  },
  "popup-track-information-scroll-enabled": {
    property: "popupTrackInformationScrollEnabled",
    read: "get_boolean",
    impact: WidgetFlags.POPUP_TRACK_INFORMATION,
  },
  "popup-track-information-scroll-speed": {
    property: "popupTrackInformationScrollSpeed",
    read: "get_uint",
    transform: createNumericConstraint(TEXT_SCROLL_SPEED),
    impact: WidgetFlags.POPUP_TRACK_INFORMATION,
  },
  "popup-track-information-scroll-pause-time": {
    property: "popupTrackInformationScrollPauseMilliseconds",
    read: "get_uint",
    transform: createSecondsToMillisecondsTransform(TEXT_SCROLL_PAUSE_SECONDS),
    impact: WidgetFlags.POPUP_TRACK_INFORMATION,
  },
  "popup-app-icon-use-color": {
    property: "popupAppIconUseColor",
    read: "get_boolean",
    impact: WidgetFlags.POPUP_APP_SELECTOR,
  },

  // Top bar
  "top-bar-track-information-show": {
    property: "topBarTrackInformationShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
  },
  "top-bar-track-information-width": {
    property: "topBarTrackInformationWidth",
    read: "get_uint",
    transform: createNumericConstraint(TOP_BAR_TRACK_INFORMATION_WIDTH),
    impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
  },
  "top-bar-track-information-width-lock": {
    property: "topBarTrackInformationWidthLock",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
  },
  "top-bar-track-information-scroll-enabled": {
    property: "topBarTrackInformationScrollEnabled",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
  },
  "top-bar-track-information-scroll-speed": {
    property: "topBarTrackInformationScrollSpeed",
    read: "get_uint",
    transform: createNumericConstraint(TEXT_SCROLL_SPEED),
    impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
  },
  "top-bar-track-information-scroll-pause-time": {
    property: "topBarTrackInformationScrollPauseMilliseconds",
    read: "get_uint",
    transform: createSecondsToMillisecondsTransform(TEXT_SCROLL_PAUSE_SECONDS),
    impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
  },
  "top-bar-track-information-content": {
    property: "topBarTrackInformationContent",
    read: "get_strv",
    transform: (value) =>
      normalizeTrackInformationContent(
        value,
        TOP_BAR_TRACK_INFORMATION_CONTENT_DEFAULT,
      ),
    impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
  },
  "top-bar-app-icon-show": {
    property: "topBarAppIconShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_APP_ICON,
  },
  "top-bar-app-icon-use-color": {
    property: "topBarAppIconUseColor",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_APP_ICON,
  },
  "top-bar-visualizer-show": {
    property: "topBarVisualizerShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_VISUALIZER,
  },
  "top-bar-visualizer-style": {
    property: "topBarVisualizerStyle",
    read: "get_enum",
    fallback: VisualizerStyles.WAVE,
    impact: WidgetFlags.TOP_BAR_VISUALIZER,
  },
  "top-bar-visualizer-speed": {
    property: "topBarVisualizerSpeed",
    read: "get_uint",
    transform: createNumericConstraint(TOP_BAR_VISUALIZER_SPEED),
    impact: WidgetFlags.TOP_BAR_VISUALIZER,
  },
  "top-bar-playback-controls-show": {
    property: "topBarPlaybackControlsShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_PLAYBACK_CONTROLS,
  },
  "top-bar-playback-controls-repeat-show": {
    property: "topBarPlaybackControlsRepeatShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_PLAYBACK_REPEAT,
  },
  "top-bar-playback-controls-previous-track-show": {
    property: "topBarPlaybackControlsPreviousTrackShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_PLAYBACK_PREVIOUS,
  },
  "top-bar-playback-controls-play-pause-show": {
    property: "topBarPlaybackControlsPlayPauseShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_PLAYBACK_PLAY_PAUSE,
  },
  "top-bar-playback-controls-next-track-show": {
    property: "topBarPlaybackControlsNextTrackShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_PLAYBACK_NEXT,
  },
  "top-bar-playback-controls-shuffle-show": {
    property: "topBarPlaybackControlsShuffleShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_PLAYBACK_SHUFFLE,
  },
  "top-bar-element-order": {
    property: "topBarElementOrder",
    read: "get_strv",
    transform: (value) =>
      normalizeOrderedValues(value, TOP_BAR_ELEMENT_ORDER_DEFAULT),
    impact: WidgetFlags.TOP_BAR_ELEMENT_ORDER,
  },

  // Panel
  "panel-position": {
    property: "panelPosition",
    read: "get_enum",
    fallback: 1,
    transform: (value) => enumValueByIndex(PanelPositions, value),
    action: SettingsAction.REBUILD_TOP_BAR_BUTTON,
  },
  "panel-index": {
    property: "panelIndex",
    read: "get_uint",
    transform: createNumericConstraint(PANEL_INDEX),
    action: SettingsAction.REBUILD_TOP_BAR_BUTTON,
  },

  // Interactions
  "interactions-mouse-action-left": {
    property: "interactionsMouseActionLeft",
    read: "get_enum",
    fallback: InputActions.TOGGLE_POPUP,
  },
  "interactions-mouse-action-middle": {
    property: "interactionsMouseActionMiddle",
    read: "get_enum",
    fallback: InputActions.OPEN_PREFERENCES,
  },
  "interactions-mouse-action-right": {
    property: "interactionsMouseActionRight",
    read: "get_enum",
    fallback: InputActions.RAISE_APP,
  },
  "interactions-mouse-action-double": {
    property: "interactionsMouseActionDouble",
    read: "get_enum",
    fallback: InputActions.NONE,
  },
  "interactions-mouse-action-scroll-up": {
    property: "interactionsMouseActionScrollUp",
    read: "get_enum",
    fallback: InputActions.VOLUME_UP,
  },
  "interactions-mouse-action-scroll-down": {
    property: "interactionsMouseActionScrollDown",
    read: "get_enum",
    fallback: InputActions.VOLUME_DOWN,
  },

  // Others
  "gnome-shell-hide-media-controls": {
    property: "gnomeShellHideMediaControls",
    read: "get_boolean",
    action: SettingsAction.UPDATE_GNOME_SHELL_MEDIA_CONTROLS,
  },
  "album-art-cache-enabled": {
    property: "albumArtCacheEnabled",
    read: "get_boolean",
    impact: WidgetFlags.POPUP_ALBUM_ART,
  },
  "blocked-apps": {
    property: "blockedAppIds",
    read: "get_strv",
    transform: normalizeUniqueStrings,
    action: SettingsAction.UPDATE_BLOCKED_APPS,
  },
});
