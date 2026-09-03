/**
 * @file settingsSpec.js
 * @module shell.settings.settingsSpec
 *
 * Declares runtime metadata for every MediaShell GSettings key.
 *
 * SettingsStore uses the spec to validate key types, expose transformed values,
 * and decide which runtime action a key change requires. This module owns the
 * action identifiers because they form part of that settings contract; domain
 * behavior remains in controllers and services.
 */

import {
  POPUP_ALBUM_ART_CORNER_RADIUS_CONSTRAINTS,
  POPUP_TRACK_INFORMATION_CONTENT_DEFAULT,
  POPUP_WIDTH_CONSTRAINTS,
  SettingsKeys,
  TRACK_INFORMATION_SCROLL_PAUSE_SECONDS_CONSTRAINTS,
  TRACK_INFORMATION_SCROLL_SPEED_CONSTRAINTS,
  TOP_BAR_ALBUM_ART_CORNER_RADIUS_CONSTRAINTS,
  TOP_BAR_ELEMENT_ORDER_DEFAULT,
  TOP_BAR_TRACK_INFORMATION_CONTENT_DEFAULT,
  PANEL_INDEX_CONSTRAINTS,
  TOP_BAR_TRACK_INFORMATION_WIDTH_CONSTRAINTS,
  TOP_BAR_VISUALIZER_SPEED_CONSTRAINTS,
} from "../../shared/constants/settings.js";
import {
  PlaybackControlSurfaceDefinitions,
  PlaybackControlSurfaces,
} from "../../shared/constants/playbackControlSurfaces.js";
import { normalizeInputAction } from "../../shared/utils/inputActions.js";
import { InputActions } from "../../shared/enums/input.js";
import { PanelPositions } from "../../shared/enums/panel.js";
import { WidgetFlags } from "../../shared/enums/widgetFlags.js";
import { normalizeTrackInformationContent } from "../../shared/utils/trackInformation.js";
import {
  enumValueByIndex,
  normalizeOrderedValues,
  normalizeUniqueStrings,
} from "../../shared/utils/format.js";

export const SettingsAction = Object.freeze({
  REBUILD_INDICATOR: "rebuild-indicator",
  UPDATE_BLOCKED_APPS: "update-blocked-apps",
  UPDATE_GNOME_SHELL_HIDE_MEDIA_CONTROLS:
    "update-gnome-shell-hide-media-controls",
  UPDATE_GNOME_SHELL_ENHANCE_MEDIA_CONTROLS:
    "update-gnome-shell-enhance-media-controls",
});

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

function createPlaybackControlSettingsSpec(surface) {
  const { show, controls } = PlaybackControlSurfaceDefinitions[surface];
  return Object.fromEntries([
    [
      show.settingKey,
      { property: show.property, read: "get_boolean", impact: show.impact },
    ],
    ...controls.map(({ settingKey, property, impact }) => [
      settingKey,
      { property, read: "get_boolean", impact },
    ]),
  ]);
}

const POPUP_PLAYBACK_CONTROL_SETTINGS_SPEC = createPlaybackControlSettingsSpec(
  PlaybackControlSurfaces.POPUP,
);
const TOP_BAR_PLAYBACK_CONTROL_SETTINGS_SPEC =
  createPlaybackControlSettingsSpec(PlaybackControlSurfaces.TOP_BAR);

export const SETTINGS_SPEC = Object.freeze({
  // Popup
  [SettingsKeys.POPUP_WIDTH]: {
    property: "popupWidth",
    read: "get_uint",
    transform: createNumericConstraint(POPUP_WIDTH_CONSTRAINTS),
    impact:
      WidgetFlags.POPUP_ALBUM_ART |
      WidgetFlags.POPUP_TRACK_INFORMATION |
      WidgetFlags.POPUP_PROGRESS_BAR |
      WidgetFlags.POPUP_VOLUME_CONTROL,
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
    transform: createNumericConstraint(
      POPUP_ALBUM_ART_CORNER_RADIUS_CONSTRAINTS,
    ),
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
  [SettingsKeys.POPUP_VOLUME_CONTROL_SHOW]: {
    property: "popupVolumeControlShow",
    read: "get_boolean",
    impact: WidgetFlags.POPUP_VOLUME_CONTROL,
  },
  ...POPUP_PLAYBACK_CONTROL_SETTINGS_SPEC,
  [SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_ENABLED]: {
    property: "popupTrackInformationScrollEnabled",
    read: "get_boolean",
    impact: WidgetFlags.POPUP_TRACK_INFORMATION,
  },
  [SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_SPEED]: {
    property: "popupTrackInformationScrollSpeed",
    read: "get_uint",
    transform: createNumericConstraint(
      TRACK_INFORMATION_SCROLL_SPEED_CONSTRAINTS,
    ),
    impact: WidgetFlags.POPUP_TRACK_INFORMATION,
  },
  [SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_PAUSE_TIME]: {
    property: "popupTrackInformationScrollPauseMilliseconds",
    read: "get_uint",
    transform: createSecondsToMillisecondsTransform(
      TRACK_INFORMATION_SCROLL_PAUSE_SECONDS_CONSTRAINTS,
    ),
    impact: WidgetFlags.POPUP_TRACK_INFORMATION,
  },
  [SettingsKeys.POPUP_MEDIA_APP_ICON_USE_COLOR]: {
    property: "popupMediaAppIconUseColor",
    read: "get_boolean",
    impact: WidgetFlags.POPUP_MEDIA_APP_SELECTOR,
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
    transform: createNumericConstraint(
      TOP_BAR_TRACK_INFORMATION_WIDTH_CONSTRAINTS,
    ),
    impact: WidgetFlags.TOP_BAR_LAYOUT,
  },
  [SettingsKeys.TOP_BAR_TRACK_INFORMATION_WIDTH_LOCK]: {
    property: "topBarTrackInformationWidthLock",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_LAYOUT,
  },
  [SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_ENABLED]: {
    property: "topBarTrackInformationScrollEnabled",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
  },
  [SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_SPEED]: {
    property: "topBarTrackInformationScrollSpeed",
    read: "get_uint",
    transform: createNumericConstraint(
      TRACK_INFORMATION_SCROLL_SPEED_CONSTRAINTS,
    ),
    impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
  },
  [SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_PAUSE_TIME]: {
    property: "topBarTrackInformationScrollPauseMilliseconds",
    read: "get_uint",
    transform: createSecondsToMillisecondsTransform(
      TRACK_INFORMATION_SCROLL_PAUSE_SECONDS_CONSTRAINTS,
    ),
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
  [SettingsKeys.TOP_BAR_MEDIA_APP_ICON_SHOW]: {
    property: "topBarMediaAppIconShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_MEDIA_APP_ICON,
  },
  [SettingsKeys.TOP_BAR_MEDIA_APP_ICON_USE_COLOR]: {
    property: "topBarMediaAppIconUseColor",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_MEDIA_APP_ICON,
  },
  [SettingsKeys.TOP_BAR_ALBUM_ART_SHOW]: {
    property: "topBarAlbumArtShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_ALBUM_ART,
  },
  [SettingsKeys.TOP_BAR_ALBUM_ART_CORNER_RADIUS]: {
    property: "topBarAlbumArtCornerRadius",
    read: "get_uint",
    transform: createNumericConstraint(
      TOP_BAR_ALBUM_ART_CORNER_RADIUS_CONSTRAINTS,
    ),
    impact: WidgetFlags.TOP_BAR_ALBUM_ART,
  },
  [SettingsKeys.TOP_BAR_VISUALIZER_SHOW]: {
    property: "topBarVisualizerShow",
    read: "get_boolean",
    impact: WidgetFlags.TOP_BAR_VISUALIZER,
  },
  [SettingsKeys.TOP_BAR_VISUALIZER_STYLE]: {
    property: "topBarVisualizerStyle",
    read: "get_enum",
    impact: WidgetFlags.TOP_BAR_VISUALIZER,
  },
  [SettingsKeys.TOP_BAR_VISUALIZER_SPEED]: {
    property: "topBarVisualizerSpeed",
    read: "get_uint",
    transform: createNumericConstraint(TOP_BAR_VISUALIZER_SPEED_CONSTRAINTS),
    impact: WidgetFlags.TOP_BAR_VISUALIZER,
  },
  ...TOP_BAR_PLAYBACK_CONTROL_SETTINGS_SPEC,
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
    transform: (value) => enumValueByIndex(PanelPositions, value),
    action: SettingsAction.REBUILD_INDICATOR,
  },
  [SettingsKeys.PANEL_INDEX]: {
    property: "panelIndex",
    read: "get_uint",
    transform: createNumericConstraint(PANEL_INDEX_CONSTRAINTS),
    action: SettingsAction.REBUILD_INDICATOR,
  },

  // Interactions
  [SettingsKeys.INTERACTIONS_MOUSE_ACTION_LEFT]: {
    property: "interactionsMouseActionLeft",
    read: "get_enum",
    transform: (value) => normalizeInputAction(value, InputActions.NONE),
  },
  [SettingsKeys.INTERACTIONS_MOUSE_ACTION_MIDDLE]: {
    property: "interactionsMouseActionMiddle",
    read: "get_enum",
    transform: (value) => normalizeInputAction(value, InputActions.NONE),
  },
  [SettingsKeys.INTERACTIONS_MOUSE_ACTION_RIGHT]: {
    property: "interactionsMouseActionRight",
    read: "get_enum",
    transform: (value) => normalizeInputAction(value, InputActions.NONE),
  },
  [SettingsKeys.INTERACTIONS_MOUSE_ACTION_DOUBLE]: {
    property: "interactionsMouseActionDouble",
    read: "get_enum",
    transform: (value) => normalizeInputAction(value, InputActions.NONE),
  },
  [SettingsKeys.INTERACTIONS_MOUSE_ACTION_SCROLL_UP]: {
    property: "interactionsMouseActionScrollUp",
    read: "get_enum",
    transform: (value) => normalizeInputAction(value, InputActions.NONE),
  },
  [SettingsKeys.INTERACTIONS_MOUSE_ACTION_SCROLL_DOWN]: {
    property: "interactionsMouseActionScrollDown",
    read: "get_enum",
    transform: (value) => normalizeInputAction(value, InputActions.NONE),
  },

  // Others
  [SettingsKeys.GNOME_SHELL_HIDE_MEDIA_CONTROLS]: {
    property: "gnomeShellHideMediaControls",
    read: "get_boolean",
    action: SettingsAction.UPDATE_GNOME_SHELL_HIDE_MEDIA_CONTROLS,
  },
  [SettingsKeys.GNOME_SHELL_ENHANCE_MEDIA_CONTROLS]: {
    property: "gnomeShellEnhanceMediaControls",
    read: "get_boolean",
    action: SettingsAction.UPDATE_GNOME_SHELL_ENHANCE_MEDIA_CONTROLS,
  },
  [SettingsKeys.ALBUM_ART_CACHE_ENABLED]: {
    property: "albumArtCacheEnabled",
    read: "get_boolean",
  },
  [SettingsKeys.BLOCKED_APPS]: {
    property: "blockedAppIds",
    read: "get_strv",
    transform: normalizeUniqueStrings,
    action: SettingsAction.UPDATE_BLOCKED_APPS,
  },
});
