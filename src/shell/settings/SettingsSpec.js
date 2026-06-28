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
    POPUP_WIDTH,
    TEXT_SCROLL_PAUSE_SECONDS,
    TEXT_SCROLL_SPEED,
    TOP_BAR_ELEMENT_ORDER_DEFAULT,
    TOP_BAR_INDEX,
    TOP_BAR_TRACK_INFORMATION_WIDTH,
    TOP_BAR_VISUALIZER_SPEED,
} from "../../shared/constants/settings.js";
import { InputActions } from "../../shared/enums/input.js";
import { SettingsAction } from "../../shared/enums/settings.js";
import { TopBarPositions } from "../../shared/enums/topBar.js";
import { VisualizerStyles } from "../../shared/enums/visualizer.js";
import { WidgetFlags } from "../../shared/enums/widget.js";
import { enumValueByIndex, normalizeOrderedValues, normalizeUniqueStrings } from "../../shared/utils/format.js";

// Compatibility re-export for legacy imports; new code should import SettingsAction from shared/enums/settings.js
export { SettingsAction };

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
    return (value) => Math.min(MAX, Math.max(MIN, Number.isFinite(value) ? value : DEFAULT));
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


export const SETTINGS_SPEC = Object.freeze({
    "top-bar-track-information-width": {
        property: "topBarTrackInformationWidth",
        read: "get_uint",
        transform: createNumericConstraint(TOP_BAR_TRACK_INFORMATION_WIDTH),
        impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
    },
    "lock-top-bar-track-information-width": {
        property: "isTopBarTrackInformationWidthLocked",
        read: "get_boolean",
        impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
    },
    "top-bar-scroll-track-information": {
        property: "topBarScrollTrackInformation",
        read: "get_boolean",
        impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
    },
    "top-bar-scroll-speed": {
        property: "topBarScrollSpeed",
        read: "get_uint",
        transform: createNumericConstraint(TEXT_SCROLL_SPEED),
        impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
    },
    "top-bar-scroll-pause-time": {
        property: "topBarScrollPauseMilliseconds",
        read: "get_uint",
        transform: createSecondsToMillisecondsTransform(TEXT_SCROLL_PAUSE_SECONDS),
        impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
    },
    "popup-scroll-track-information": {
        property: "popupScrollTrackInformation",
        read: "get_boolean",
        impact: WidgetFlags.POPUP_TRACK_INFORMATION,
    },
    "popup-scroll-speed": {
        property: "popupScrollSpeed",
        read: "get_uint",
        transform: createNumericConstraint(TEXT_SCROLL_SPEED),
        impact: WidgetFlags.POPUP_TRACK_INFORMATION,
    },
    "popup-scroll-pause-time": {
        property: "popupScrollPauseMilliseconds",
        read: "get_uint",
        transform: createSecondsToMillisecondsTransform(TEXT_SCROLL_PAUSE_SECONDS),
        impact: WidgetFlags.POPUP_TRACK_INFORMATION,
    },
    "hide-system-media-controls": {
        property: "hideSystemMediaControls",
        read: "get_boolean",
        action: SettingsAction.UPDATE_SYSTEM_MEDIA_CONTROLS,
    },
    "show-popup-progress-bar": {
        property: "showPopupProgressBar",
        read: "get_boolean",
        impact: WidgetFlags.POPUP_PROGRESS_BAR,
    },
    "show-popup-album-art": {
        property: "showPopupAlbumArt",
        read: "get_boolean",
        impact: WidgetFlags.POPUP_ALBUM_ART | WidgetFlags.POPUP_TRACK_INFORMATION | WidgetFlags.POPUP_PROGRESS_BAR,
    },
    "popup-width": {
        property: "popupWidth",
        read: "get_uint",
        transform: createNumericConstraint(POPUP_WIDTH),
        impact: WidgetFlags.POPUP_ALBUM_ART | WidgetFlags.POPUP_TRACK_INFORMATION | WidgetFlags.POPUP_PROGRESS_BAR,
    },
    "show-popup-track-information": {
        property: "showPopupTrackInformation",
        read: "get_boolean",
        impact: WidgetFlags.POPUP_TRACK_INFORMATION,
    },
    "show-popup-title": {
        property: "showPopupTitle",
        read: "get_boolean",
        impact: WidgetFlags.POPUP_TRACK_INFORMATION,
    },
    "show-popup-artist": {
        property: "showPopupArtist",
        read: "get_boolean",
        impact: WidgetFlags.POPUP_TRACK_INFORMATION,
    },
    "show-popup-album": {
        property: "showPopupAlbum",
        read: "get_boolean",
        impact: WidgetFlags.POPUP_TRACK_INFORMATION,
    },
    "show-top-bar-track-information": {
        property: "showTopBarTrackInformation",
        read: "get_boolean",
        impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
    },
    "show-top-bar-visualizer": {
        property: "showTopBarVisualizer",
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
    "show-top-bar-app-icon": {
        property: "showTopBarAppIcon",
        read: "get_boolean",
        impact: WidgetFlags.TOP_BAR_APP_ICON,
    },
    "show-top-bar-playback-controls": {
        property: "showTopBarPlaybackControls",
        read: "get_boolean",
        impact: WidgetFlags.TOP_BAR_PLAYBACK_CONTROLS,
    },
    "show-top-bar-play-pause": {
        property: "showTopBarPlayPause",
        read: "get_boolean",
        impact: WidgetFlags.TOP_BAR_PLAYBACK_PLAY_PAUSE,
    },
    "show-top-bar-next-track": {
        property: "showTopBarNextTrack",
        read: "get_boolean",
        impact: WidgetFlags.TOP_BAR_PLAYBACK_NEXT,
    },
    "show-top-bar-previous-track": {
        property: "showTopBarPreviousTrack",
        read: "get_boolean",
        impact: WidgetFlags.TOP_BAR_PLAYBACK_PREVIOUS,
    },
    "use-colored-top-bar-app-icon": {
        property: "useColoredTopBarAppIcon",
        read: "get_boolean",
        impact: WidgetFlags.TOP_BAR_APP_ICON,
    },
    "use-colored-popup-app-icon": {
        property: "useColoredPopupAppIcon",
        read: "get_boolean",
        impact: WidgetFlags.POPUP_APP_SELECTOR,
    },
    "popup-album-art-corner-radius": {
        property: "popupAlbumArtCornerRadius",
        read: "get_uint",
        transform: createNumericConstraint(POPUP_ALBUM_ART_CORNER_RADIUS),
        impact: WidgetFlags.POPUP_ALBUM_ART,
    },
    "top-bar-position": {
        property: "topBarPosition",
        read: "get_enum",
        fallback: 1,
        transform: (value) => enumValueByIndex(TopBarPositions, value),
        action: SettingsAction.REBUILD_TOP_BAR_BUTTON,
    },
    "top-bar-index": {
        property: "topBarIndex",
        read: "get_uint",
        transform: createNumericConstraint(TOP_BAR_INDEX),
        action: SettingsAction.REBUILD_TOP_BAR_BUTTON,
    },
    "top-bar-element-order": {
        property: "topBarElementOrder",
        read: "get_strv",
        transform: (value) => normalizeOrderedValues(value, TOP_BAR_ELEMENT_ORDER_DEFAULT),
        impact: WidgetFlags.TOP_BAR_ELEMENT_ORDER,
    },
    "top-bar-track-information-content": {
        property: "topBarTrackInformationContent",
        read: "get_strv",
        impact: WidgetFlags.TOP_BAR_TRACK_INFORMATION,
    },
    "mouse-action-left": { property: "mouseActionLeft", read: "get_enum", fallback: InputActions.TOGGLE_POPUP },
    "mouse-action-middle": { property: "mouseActionMiddle", read: "get_enum", fallback: InputActions.OPEN_PREFERENCES },
    "mouse-action-right": { property: "mouseActionRight", read: "get_enum", fallback: InputActions.RAISE_APP },
    "mouse-action-double": { property: "mouseActionDouble", read: "get_enum", fallback: InputActions.NONE },
    "mouse-action-scroll-up": { property: "mouseActionScrollUp", read: "get_enum", fallback: InputActions.VOLUME_UP },
    "mouse-action-scroll-down": {
        property: "mouseActionScrollDown",
        read: "get_enum",
        fallback: InputActions.VOLUME_DOWN,
    },
    "cache-album-art": {
        property: "cacheAlbumArt",
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
