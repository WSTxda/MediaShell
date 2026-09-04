/**
 * @file surfaces.js
 * @module shared.playback.surfaces
 *
 * Declares the settings policy shared by popup and top bar playback controls.
 *
 * The policy is static data only: stable GSettings keys and controller property
 * names. Shell and Preferences consume the same definitions
 * while retaining separate actors and GtkBuilder layouts. Keeping each control's
 * settings ownership beside each control avoids duplicated cross-process policy;
 * Shell-specific invalidation mapping lives in shell/media/playback.
 */

import { PlaybackControlIds } from "./controls.js";
import { SettingsKeys } from "../settings/contract.js";

/** Stable surface IDs used by runtime and preferences code. */
export const PlaybackControlSurfaces = Object.freeze({
  POPUP: "popup",
  TOP_BAR: "top-bar",
});

function createControlSetting(controlId, settingKey, property) {
  return Object.freeze({ controlId, settingKey, property });
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
 * Each surface declares cross-process visibility ownership once. Layout modules
 * retain their own row/order policy, while Shell-specific invalidation remains
 * outside this shared contract.
 */
export const PlaybackControlSurfaceDefinitions = Object.freeze({
  [PlaybackControlSurfaces.POPUP]: createSurfaceDefinition(
    {
      settingKey: SettingsKeys.POPUP_PLAYBACK_CONTROLS_SHOW,
      property: "popupPlaybackControlsShow",
    },
    [
      createControlSetting(
        PlaybackControlIds.SHUFFLE,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_SHUFFLE_SHOW,
        "popupPlaybackControlsShuffleShow",
      ),
      createControlSetting(
        PlaybackControlIds.SEEK_BACKWARD,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_SEEK_BACKWARD_SHOW,
        "popupPlaybackControlsSeekBackwardShow",
      ),
      createControlSetting(
        PlaybackControlIds.PREVIOUS,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_PREVIOUS_TRACK_SHOW,
        "popupPlaybackControlsPreviousTrackShow",
      ),
      createControlSetting(
        PlaybackControlIds.PLAY_PAUSE,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_PLAY_PAUSE_SHOW,
        "popupPlaybackControlsPlayPauseShow",
      ),
      createControlSetting(
        PlaybackControlIds.NEXT,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_NEXT_TRACK_SHOW,
        "popupPlaybackControlsNextTrackShow",
      ),
      createControlSetting(
        PlaybackControlIds.SEEK_FORWARD,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_SEEK_FORWARD_SHOW,
        "popupPlaybackControlsSeekForwardShow",
      ),
      createControlSetting(
        PlaybackControlIds.REPEAT,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_REPEAT_SHOW,
        "popupPlaybackControlsRepeatShow",
      ),
      createControlSetting(
        PlaybackControlIds.SPEED,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_SPEED_SHOW,
        "popupPlaybackControlsSpeedShow",
      ),
    ],
  ),
  [PlaybackControlSurfaces.TOP_BAR]: createSurfaceDefinition(
    {
      settingKey: SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SHOW,
      property: "topBarPlaybackControlsShow",
    },
    [
      createControlSetting(
        PlaybackControlIds.SHUFFLE,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SHUFFLE_SHOW,
        "topBarPlaybackControlsShuffleShow",
      ),
      createControlSetting(
        PlaybackControlIds.SEEK_BACKWARD,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SEEK_BACKWARD_SHOW,
        "topBarPlaybackControlsSeekBackwardShow",
      ),
      createControlSetting(
        PlaybackControlIds.PREVIOUS,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_PREVIOUS_TRACK_SHOW,
        "topBarPlaybackControlsPreviousTrackShow",
      ),
      createControlSetting(
        PlaybackControlIds.PLAY_PAUSE,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_PLAY_PAUSE_SHOW,
        "topBarPlaybackControlsPlayPauseShow",
      ),
      createControlSetting(
        PlaybackControlIds.NEXT,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_NEXT_TRACK_SHOW,
        "topBarPlaybackControlsNextTrackShow",
      ),
      createControlSetting(
        PlaybackControlIds.SEEK_FORWARD,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SEEK_FORWARD_SHOW,
        "topBarPlaybackControlsSeekForwardShow",
      ),
      createControlSetting(
        PlaybackControlIds.REPEAT,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_REPEAT_SHOW,
        "topBarPlaybackControlsRepeatShow",
      ),
    ],
  ),
});
