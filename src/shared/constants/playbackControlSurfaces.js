/**
 * @file playbackControlSurfaces.js
 * @module shared.constants.playbackControlSurfaces
 *
 * Declares the settings policy shared by popup and top bar playback controls.
 *
 * The policy is static data only: stable GSettings keys, controller property
 * names, and update flags. Shell and Preferences consume the same definitions
 * while retaining separate actors and GtkBuilder layouts. Keeping each control's
 * impact beside its setting avoids a second synchronized map when controls are
 * added; the table imports no runtime objects and does not own actor behavior.
 */

import { PlaybackControlIds } from "./playbackControls.js";
import { SettingsKeys } from "./settings.js";
import { WidgetFlags } from "../enums/widgetFlags.js";

/** Stable surface IDs used by runtime and preferences code. */
export const PlaybackControlSurfaces = Object.freeze({
  POPUP: "popup",
  TOP_BAR: "top-bar",
});

function createControlSetting(
  controlId,
  settingKey,
  property,
  impact,
  { requiresSurfaceEnabled = true } = {},
) {
  return Object.freeze({
    controlId,
    settingKey,
    property,
    impact,
    requiresSurfaceEnabled,
  });
}

function createSurfaceDefinition(show, controls) {
  return Object.freeze({
    show: Object.freeze(show),
    controls: Object.freeze(controls),
  });
}

/**
 * Canonical settings ownership for each playback-control surface.
 *
 * Each surface declares visibility and update ownership once. Layout modules
 * retain their own row/order policy, but renderers must not re-declare settings
 * properties or WidgetFlags independently.
 */
export const PlaybackControlSurfaceDefinitions = Object.freeze({
  [PlaybackControlSurfaces.POPUP]: createSurfaceDefinition(
    {
      settingKey: SettingsKeys.POPUP_PLAYBACK_CONTROLS_SHOW,
      property: "popupPlaybackControlsShow",
      impact: WidgetFlags.POPUP_PLAYBACK_CONTROLS,
    },
    [
      createControlSetting(
        PlaybackControlIds.SHUFFLE,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_SHUFFLE_SHOW,
        "popupPlaybackControlsShuffleShow",
        WidgetFlags.POPUP_PLAYBACK_SHUFFLE,
      ),
      createControlSetting(
        PlaybackControlIds.SEEK_BACKWARD,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_SEEK_BACKWARD_SHOW,
        "popupPlaybackControlsSeekBackwardShow",
        WidgetFlags.POPUP_PLAYBACK_SEEK_BACKWARD,
      ),
      createControlSetting(
        PlaybackControlIds.PREVIOUS,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_PREVIOUS_TRACK_SHOW,
        "popupPlaybackControlsPreviousTrackShow",
        WidgetFlags.POPUP_PLAYBACK_PREVIOUS,
      ),
      createControlSetting(
        PlaybackControlIds.PLAY_PAUSE,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_PLAY_PAUSE_SHOW,
        "popupPlaybackControlsPlayPauseShow",
        WidgetFlags.POPUP_PLAYBACK_PLAY_PAUSE,
      ),
      createControlSetting(
        PlaybackControlIds.NEXT,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_NEXT_TRACK_SHOW,
        "popupPlaybackControlsNextTrackShow",
        WidgetFlags.POPUP_PLAYBACK_NEXT,
      ),
      createControlSetting(
        PlaybackControlIds.SEEK_FORWARD,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_SEEK_FORWARD_SHOW,
        "popupPlaybackControlsSeekForwardShow",
        WidgetFlags.POPUP_PLAYBACK_SEEK_FORWARD,
      ),
      createControlSetting(
        PlaybackControlIds.REPEAT,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_REPEAT_SHOW,
        "popupPlaybackControlsRepeatShow",
        WidgetFlags.POPUP_PLAYBACK_REPEAT,
      ),
      createControlSetting(
        PlaybackControlIds.SPEED,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_SPEED_SHOW,
        "popupPlaybackControlsSpeedShow",
        WidgetFlags.POPUP_PLAYBACK_SPEED,
        { requiresSurfaceEnabled: false },
      ),
    ],
  ),
  [PlaybackControlSurfaces.TOP_BAR]: createSurfaceDefinition(
    {
      settingKey: SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SHOW,
      property: "topBarPlaybackControlsShow",
      impact: WidgetFlags.TOP_BAR_PLAYBACK_CONTROLS,
    },
    [
      createControlSetting(
        PlaybackControlIds.SHUFFLE,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SHUFFLE_SHOW,
        "topBarPlaybackControlsShuffleShow",
        WidgetFlags.TOP_BAR_PLAYBACK_SHUFFLE,
      ),
      createControlSetting(
        PlaybackControlIds.SEEK_BACKWARD,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SEEK_BACKWARD_SHOW,
        "topBarPlaybackControlsSeekBackwardShow",
        WidgetFlags.TOP_BAR_PLAYBACK_SEEK_BACKWARD,
      ),
      createControlSetting(
        PlaybackControlIds.PREVIOUS,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_PREVIOUS_TRACK_SHOW,
        "topBarPlaybackControlsPreviousTrackShow",
        WidgetFlags.TOP_BAR_PLAYBACK_PREVIOUS,
      ),
      createControlSetting(
        PlaybackControlIds.PLAY_PAUSE,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_PLAY_PAUSE_SHOW,
        "topBarPlaybackControlsPlayPauseShow",
        WidgetFlags.TOP_BAR_PLAYBACK_PLAY_PAUSE,
      ),
      createControlSetting(
        PlaybackControlIds.NEXT,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_NEXT_TRACK_SHOW,
        "topBarPlaybackControlsNextTrackShow",
        WidgetFlags.TOP_BAR_PLAYBACK_NEXT,
      ),
      createControlSetting(
        PlaybackControlIds.SEEK_FORWARD,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SEEK_FORWARD_SHOW,
        "topBarPlaybackControlsSeekForwardShow",
        WidgetFlags.TOP_BAR_PLAYBACK_SEEK_FORWARD,
      ),
      createControlSetting(
        PlaybackControlIds.REPEAT,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_REPEAT_SHOW,
        "topBarPlaybackControlsRepeatShow",
        WidgetFlags.TOP_BAR_PLAYBACK_REPEAT,
      ),
    ],
  ),
});
