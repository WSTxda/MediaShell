/**
 * @file settingsSpec.js
 * @module shell.settings.settingsSpec
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
  SettingsKeys,
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
 * bounds in SETTINGS_SPEC prevents invalid schema or user-edited values from
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
  [SettingsKeys.POPUP_WIDTH]: {
    property: "popupWidth",
    read: "get_uint",
    transform: createNumericConstraint(POPUP_WIDTH),
    impact:
      WidgetFlags.POPUP_ALBUM_ART |
      WidgetFlags.POPUP_TRACK_INFORMATION |
      WidgetFlags.POPUP_PROGRESS_BAR,
  },
  [SettingsKeys.POPUP_ALBUM_ART_SHOW]: {
    property: "popupAlbumArtShow",
    read: "get_boolean",
    impact:
      WidgetFlags.POPUP_ALBUM_ART |
      WidgetFlags.POPUP_TRACK_INFORMATION |
      WidgetFlags.POPUP_PROGRESS_BAR,
  },
  [SettingsKeys.POPUP_ALBUM_ART_CORNER_RADIUS]: {
    property: "popupAlbumArtCornerRadius",
    read: "get_uint",
    transform: createNumericConstraint(POPUP_ALBUM_ART_CORNER_RADIUS),
    impact: WidgetFlags.POPUP_ALBUM_ART,
  },
  [SettingsKeys.POPUP_TRACK_INFORMATION_SHOW]: {
    property: "popupTrackInformationShow",
    read: "get_boolean",
    impact: WidgetFlags.POPUP_TRACK_INFORMATION,
  },
  [SettingsKeys.POPUP_TRACK_INFORMATION_CONTENT]: {
    property: "popupTrackInformationContent",
    read: "get_strv",
    transform: (value) =>
      normalizeTrackInformationContent(
        value,
        POPUP_TRACK_INFORMATION_CONTENT_DEFAULT,
      ),
    impact: WidgetFlags.POPUP_TRACK_INFORMATION,
  },
  [SettingsKeys.POPUP_PROGRESS_BAR_SHOW]: {
    property: "popupProgressBarShow",
    read: "get_boolean",
    impact: WidgetFlags.POPUP_PROGRESS_BAR,
  },
  [SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_ENABLED]: {
    property: "popupTrackInformationScrollEnabled",
    read: "get_boolean",
    impact: WidgetFlags.POPUP_TRACK_INFORMATION,
  },
  [SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_SPEED]: {
    property: "popupTrackInformationScrollSpeed",
    read: "get_uint",
    transform: createNumericConstraint(TEXT_SCROLL_SPEED),
    impact: WidgetFlags.POPUP_TRACK_INFORMATION,
  },
  [SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_PAUSE_TIME]: {
    property: "popupTrackInformationScrollPauseMilliseconds",
    read: "get_uint",
    transform: createSecondsToMillisecondsTransform(TEXT_SCROLL_PAUSE_SECONDS),
    impact: WidgetFlags.POPUP_TRACK_INFORMATION,
  },
  [SettingsKeys.POPUP_APP_ICON_USE_COLOR]: {
    property: "popupAppIconUseColor",
    read: "get_boolean",
    impact: WidgetFlags.POPUP_APP_SELECTOR,
  },

  // Top bar
  [SettingsKeys.TOP_BAR_TRACK_INFORMATION_SHOW]: {
    property: "topBarTrackInformationShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
  },
  [SettingsKeys.TOP_BAR_TRACK_INFORMATION_WIDTH]: {
    property: "topBarTrackInformationWidth",
    read: "get_uint",
    transform: createNumericConstraint(TOP_BAR_TRACK_INFORMATION_WIDTH),
    impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
  },
  [SettingsKeys.TOP_BAR_TRACK_INFORMATION_WIDTH_LOCK]: {
    property: "topBarTrackInformationWidthLock",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
  },
  [SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_ENABLED]: {
    property: "topBarTrackInformationScrollEnabled",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
  },
  [SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_SPEED]: {
    property: "topBarTrackInformationScrollSpeed",
    read: "get_uint",
    transform: createNumericConstraint(TEXT_SCROLL_SPEED),
    impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
  },
  [SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_PAUSE_TIME]: {
    property: "topBarTrackInformationScrollPauseMilliseconds",
    read: "get_uint",
    transform: createSecondsToMillisecondsTransform(TEXT_SCROLL_PAUSE_SECONDS),
    impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
  },
  [SettingsKeys.TOP_BAR_TRACK_INFORMATION_CONTENT]: {
    property: "topBarTrackInformationContent",
    read: "get_strv",
    transform: (value) =>
      normalizeTrackInformationContent(
        value,
        TOP_BAR_TRACK_INFORMATION_CONTENT_DEFAULT,
      ),
    impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
  },
  [SettingsKeys.TOP_BAR_APP_ICON_SHOW]: {
    property: "topBarAppIconShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_APP_ICON,
  },
  [SettingsKeys.TOP_BAR_APP_ICON_USE_COLOR]: {
    property: "topBarAppIconUseColor",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_APP_ICON,
  },
  [SettingsKeys.TOP_BAR_VISUALIZER_SHOW]: {
    property: "topBarVisualizerShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_VISUALIZER,
  },
  [SettingsKeys.TOP_BAR_VISUALIZER_STYLE]: {
    property: "topBarVisualizerStyle",
    read: "get_enum",
    fallback: VisualizerStyles.BEATS,
    impact: WidgetFlags.TOP_BAR_VISUALIZER,
  },
  [SettingsKeys.TOP_BAR_VISUALIZER_SPEED]: {
    property: "topBarVisualizerSpeed",
    read: "get_uint",
    transform: createNumericConstraint(TOP_BAR_VISUALIZER_SPEED),
    impact: WidgetFlags.TOP_BAR_VISUALIZER,
  },
  [SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SHOW]: {
    property: "topBarPlaybackControlsShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_PLAYBACK_CONTROLS,
  },
  [SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SHUFFLE_SHOW]: {
    property: "topBarPlaybackControlsShuffleShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_PLAYBACK_SHUFFLE,
  },
  [SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_PREVIOUS_TRACK_SHOW]: {
    property: "topBarPlaybackControlsPreviousTrackShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_PLAYBACK_PREVIOUS,
  },
  [SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_PLAY_PAUSE_SHOW]: {
    property: "topBarPlaybackControlsPlayPauseShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_PLAYBACK_PLAY_PAUSE,
  },
  [SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_NEXT_TRACK_SHOW]: {
    property: "topBarPlaybackControlsNextTrackShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_PLAYBACK_NEXT,
  },
  [SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_REPEAT_SHOW]: {
    property: "topBarPlaybackControlsRepeatShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_PLAYBACK_REPEAT,
  },
  [SettingsKeys.TOP_BAR_ELEMENT_ORDER]: {
    property: "topBarElementOrder",
    read: "get_strv",
    transform: (value) =>
      normalizeOrderedValues(value, TOP_BAR_ELEMENT_ORDER_DEFAULT),
    impact: WidgetFlags.TOP_BAR_ELEMENT_ORDER,
  },

  // Panel
  [SettingsKeys.PANEL_POSITION]: {
    property: "panelPosition",
    read: "get_enum",
    fallback: 1,
    transform: (value) => enumValueByIndex(PanelPositions, value),
    action: SettingsAction.REBUILD_TOP_BAR_BUTTON,
  },
  [SettingsKeys.PANEL_INDEX]: {
    property: "panelIndex",
    read: "get_uint",
    transform: createNumericConstraint(PANEL_INDEX),
    action: SettingsAction.REBUILD_TOP_BAR_BUTTON,
  },

  // Interactions
  [SettingsKeys.INTERACTIONS_MOUSE_ACTION_LEFT]: {
    property: "interactionsMouseActionLeft",
    read: "get_enum",
    fallback: InputActions.TOGGLE_POPUP,
  },
  [SettingsKeys.INTERACTIONS_MOUSE_ACTION_MIDDLE]: {
    property: "interactionsMouseActionMiddle",
    read: "get_enum",
    fallback: InputActions.OPEN_PREFERENCES,
  },
  [SettingsKeys.INTERACTIONS_MOUSE_ACTION_RIGHT]: {
    property: "interactionsMouseActionRight",
    read: "get_enum",
    fallback: InputActions.RAISE_APP,
  },
  [SettingsKeys.INTERACTIONS_MOUSE_ACTION_DOUBLE]: {
    property: "interactionsMouseActionDouble",
    read: "get_enum",
    fallback: InputActions.NONE,
  },
  [SettingsKeys.INTERACTIONS_MOUSE_ACTION_SCROLL_UP]: {
    property: "interactionsMouseActionScrollUp",
    read: "get_enum",
    fallback: InputActions.VOLUME_UP,
  },
  [SettingsKeys.INTERACTIONS_MOUSE_ACTION_SCROLL_DOWN]: {
    property: "interactionsMouseActionScrollDown",
    read: "get_enum",
    fallback: InputActions.VOLUME_DOWN,
  },

  // Others
  [SettingsKeys.GNOME_SHELL_HIDE_MEDIA_CONTROLS]: {
    property: "gnomeShellHideMediaControls",
    read: "get_boolean",
    action: SettingsAction.UPDATE_GNOME_SHELL_MEDIA_CONTROLS,
  },
  [SettingsKeys.ALBUM_ART_CACHE_ENABLED]: {
    property: "albumArtCacheEnabled",
    read: "get_boolean",
    impact: WidgetFlags.POPUP_ALBUM_ART,
  },
  [SettingsKeys.BLOCKED_APPS]: {
    property: "blockedAppIds",
    read: "get_strv",
    transform: normalizeUniqueStrings,
    action: SettingsAction.UPDATE_BLOCKED_APPS,
  },
});
