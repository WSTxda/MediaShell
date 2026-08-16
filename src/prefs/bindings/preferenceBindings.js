/**
 * @file preferenceBindings.js
 * @module prefs.bindings.preferenceBindings
 *
 * Declares the mapping from preferences widgets to GSettings keys.
 *
 * Each entry names a GtkBuilder object ID, the setting key it controls, and the
 * widget property used for binding. PreferenceBinder consumes this table as the
 * source of truth for automatic settings synchronization.
 */

import { PlaybackControlIds } from "../../shared/constants/playbackControls.js";
import {
  PlaybackControlSurfaceDefinitions,
  PlaybackControlSurfaces,
} from "../../shared/constants/playbackControlSurfaces.js";
import { SettingsKeys } from "../../shared/constants/settings.js";

const PLAYBACK_CONTROL_WIDGET_SUFFIXES = Object.freeze({
  [PlaybackControlIds.SHUFFLE]: "shuffle-show",
  [PlaybackControlIds.SEEK_BACKWARD]: "seek-backward-show",
  [PlaybackControlIds.PREVIOUS]: "previous-track-show",
  [PlaybackControlIds.PLAY_PAUSE]: "play-pause-show",
  [PlaybackControlIds.NEXT]: "next-track-show",
  [PlaybackControlIds.SEEK_FORWARD]: "seek-forward-show",
  [PlaybackControlIds.REPEAT]: "repeat-show",
  [PlaybackControlIds.SPEED]: "speed-show",
});

function createPlaybackControlBindingSet(surface) {
  const { show, controls } = PlaybackControlSurfaceDefinitions[surface];
  return Object.freeze({
    show: Object.freeze([
      show.settingKey,
      `er-${surface}-playback-controls`,
      "enable-expansion",
    ]),
    controls: Object.freeze(
      Object.fromEntries(
        controls.map(({ controlId, settingKey }) => [
          controlId,
          Object.freeze([
            settingKey,
            `sr-${surface}-playback-controls-${PLAYBACK_CONTROL_WIDGET_SUFFIXES[controlId]}`,
            "active",
          ]),
        ]),
      ),
    ),
  });
}

const POPUP_PLAYBACK_CONTROL_BINDINGS = createPlaybackControlBindingSet(
  PlaybackControlSurfaces.POPUP,
);
const TOP_BAR_PLAYBACK_CONTROL_BINDINGS = createPlaybackControlBindingSet(
  PlaybackControlSurfaces.TOP_BAR,
);

const POPUP_BINDINGS = Object.freeze([
  [SettingsKeys.POPUP_WIDTH, "sp-popup-width", "value"],
  POPUP_PLAYBACK_CONTROL_BINDINGS.show,
  ...Object.entries(POPUP_PLAYBACK_CONTROL_BINDINGS.controls)
    .filter(([controlId]) => controlId !== PlaybackControlIds.SPEED)
    .map(([, binding]) => binding),
  [
    SettingsKeys.POPUP_PROGRESS_BAR_SHOW,
    "sr-popup-progress-bar-show",
    "active",
  ],
  POPUP_PLAYBACK_CONTROL_BINDINGS.controls[PlaybackControlIds.SPEED],
  [
    SettingsKeys.POPUP_VOLUME_CONTROL_SHOW,
    "sr-popup-volume-control-show",
    "active",
  ],
  [SettingsKeys.POPUP_ALBUM_ART_SHOW, "er-popup-album-art", "enable-expansion"],
  [
    SettingsKeys.POPUP_ALBUM_ART_CORNER_RADIUS,
    "sp-popup-album-art-corner-radius",
    "value",
  ],
  [
    SettingsKeys.POPUP_TRACK_INFORMATION_SHOW,
    "er-popup-track-information",
    "enable-expansion",
  ],
  [
    SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_ENABLED,
    "sw-popup-track-information-scroll-enabled",
    "active",
  ],
  [
    SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_SPEED,
    "sp-popup-track-information-scroll-speed",
    "value",
  ],
  [
    SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_PAUSE_TIME,
    "sp-popup-track-information-scroll-pause-time",
    "value",
  ],
  [
    SettingsKeys.POPUP_MEDIA_APP_ICON_USE_COLOR,
    "sr-popup-media-app-icon-use-color",
    "active",
  ],
]);

const TOP_BAR_BINDINGS = Object.freeze([
  [
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_WIDTH,
    "sp-top-bar-track-information-width",
    "value",
  ],
  [
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_WIDTH_LOCK,
    "sr-top-bar-track-information-width-lock",
    "active",
  ],
  TOP_BAR_PLAYBACK_CONTROL_BINDINGS.show,
  ...Object.values(TOP_BAR_PLAYBACK_CONTROL_BINDINGS.controls),
  [
    SettingsKeys.TOP_BAR_VISUALIZER_SHOW,
    "er-top-bar-visualizer",
    "enable-expansion",
  ],
  [
    SettingsKeys.TOP_BAR_VISUALIZER_STYLE,
    "cr-top-bar-visualizer-style",
    "selected",
  ],
  [
    SettingsKeys.TOP_BAR_VISUALIZER_SPEED,
    "sp-top-bar-visualizer-speed",
    "value",
  ],
  [
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_SHOW,
    "er-top-bar-track-information",
    "enable-expansion",
  ],
  [
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_ENABLED,
    "sw-top-bar-track-information-scroll-enabled",
    "active",
  ],
  [
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_SPEED,
    "sp-top-bar-track-information-scroll-speed",
    "value",
  ],
  [
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_PAUSE_TIME,
    "sp-top-bar-track-information-scroll-pause-time",
    "value",
  ],
  [
    SettingsKeys.TOP_BAR_MEDIA_APP_ICON_SHOW,
    "er-top-bar-media-app-icon",
    "enable-expansion",
  ],
  [
    SettingsKeys.TOP_BAR_MEDIA_APP_ICON_USE_COLOR,
    "sr-top-bar-media-app-icon-use-color",
    "active",
  ],
  [
    SettingsKeys.TOP_BAR_ALBUM_ART_SHOW,
    "er-top-bar-album-art",
    "enable-expansion",
  ],
  [
    SettingsKeys.TOP_BAR_ALBUM_ART_CORNER_RADIUS,
    "sp-top-bar-album-art-corner-radius",
    "value",
  ],
]);

const PANEL_BINDINGS = Object.freeze([
  [SettingsKeys.PANEL_POSITION, "cr-panel-position", "selected"],
  [SettingsKeys.PANEL_INDEX, "sp-panel-index", "value"],
]);

const INTERACTIONS_BINDINGS = Object.freeze([
  [
    SettingsKeys.INTERACTIONS_SHORTCUT_TOGGLE_SHUFFLE,
    "sl-interactions-shortcut-toggle-shuffle",
    "accelerator",
  ],
  [
    SettingsKeys.INTERACTIONS_SHORTCUT_SEEK_BACKWARD,
    "sl-interactions-shortcut-seek-backward",
    "accelerator",
  ],
  [
    SettingsKeys.INTERACTIONS_SHORTCUT_PREVIOUS_TRACK,
    "sl-interactions-shortcut-previous-track",
    "accelerator",
  ],
  [
    SettingsKeys.INTERACTIONS_SHORTCUT_PLAY_PAUSE,
    "sl-interactions-shortcut-play-pause",
    "accelerator",
  ],
  [
    SettingsKeys.INTERACTIONS_SHORTCUT_NEXT_TRACK,
    "sl-interactions-shortcut-next-track",
    "accelerator",
  ],
  [
    SettingsKeys.INTERACTIONS_SHORTCUT_SEEK_FORWARD,
    "sl-interactions-shortcut-seek-forward",
    "accelerator",
  ],
  [
    SettingsKeys.INTERACTIONS_SHORTCUT_TOGGLE_LOOP,
    "sl-interactions-shortcut-toggle-loop",
    "accelerator",
  ],
  [
    SettingsKeys.INTERACTIONS_SHORTCUT_VOLUME_UP,
    "sl-interactions-shortcut-volume-up",
    "accelerator",
  ],
  [
    SettingsKeys.INTERACTIONS_SHORTCUT_VOLUME_DOWN,
    "sl-interactions-shortcut-volume-down",
    "accelerator",
  ],
  [
    SettingsKeys.INTERACTIONS_SHORTCUT_TOGGLE_POPUP,
    "sl-interactions-shortcut-toggle-popup",
    "accelerator",
  ],
  [
    SettingsKeys.INTERACTIONS_SHORTCUT_OPEN_PREFERENCES,
    "sl-interactions-shortcut-open-preferences",
    "accelerator",
  ],
  [
    SettingsKeys.INTERACTIONS_SHORTCUT_RAISE_APP,
    "sl-interactions-shortcut-raise-app",
    "accelerator",
  ],
  [
    SettingsKeys.INTERACTIONS_SHORTCUT_QUIT_APP,
    "sl-interactions-shortcut-quit-app",
    "accelerator",
  ],
  [
    SettingsKeys.INTERACTIONS_SHORTCUT_SWITCH_APP,
    "sl-interactions-shortcut-switch-app",
    "accelerator",
  ],
  [
    SettingsKeys.INTERACTIONS_MOUSE_ACTION_LEFT,
    "cr-interactions-left-click",
    "input-action-selected",
  ],
  [
    SettingsKeys.INTERACTIONS_MOUSE_ACTION_MIDDLE,
    "cr-interactions-middle-click",
    "input-action-selected",
  ],
  [
    SettingsKeys.INTERACTIONS_MOUSE_ACTION_RIGHT,
    "cr-interactions-right-click",
    "input-action-selected",
  ],
  [
    SettingsKeys.INTERACTIONS_MOUSE_ACTION_DOUBLE,
    "cr-interactions-double-click",
    "input-action-selected",
  ],
  [
    SettingsKeys.INTERACTIONS_MOUSE_ACTION_SCROLL_UP,
    "cr-interactions-scroll-up",
    "input-action-selected",
  ],
  [
    SettingsKeys.INTERACTIONS_MOUSE_ACTION_SCROLL_DOWN,
    "cr-interactions-scroll-down",
    "input-action-selected",
  ],
]);

const OTHERS_BINDINGS = Object.freeze([
  [
    SettingsKeys.GNOME_SHELL_HIDE_MEDIA_CONTROLS,
    "sr-gnome-shell-hide-media-controls",
    "active",
  ],
  [
    SettingsKeys.ALBUM_ART_CACHE_ENABLED,
    "sr-album-art-cache-enabled",
    "active",
  ],
]);

export const PREFERENCE_WIDGET_BINDINGS = Object.freeze([
  ...POPUP_BINDINGS,
  ...TOP_BAR_BINDINGS,
  ...PANEL_BINDINGS,
  ...INTERACTIONS_BINDINGS,
  ...OTHERS_BINDINGS,
]);
