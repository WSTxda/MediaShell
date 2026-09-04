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
 * Shell-specific dirty-region mapping lives with each UI surface.
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
 * retain their own row/order policy, while Shell-specific reconciliation remains
 * outside this shared contract.
 */
export const PlaybackControlSurfaceDefinitions = Object.freeze({
  [PlaybackControlSurfaces.POPUP]: createSurfaceDefinition(
    {
      settingKey: SettingsKeys.POPUP_PLAYBACK_CONTROLS_SHOW,
      property: "playbackControlsShow",
    },
    [
      createControlSetting(
        PlaybackControlIds.SHUFFLE,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_SHUFFLE_SHOW,
        "playbackControlsShuffleShow",
      ),
      createControlSetting(
        PlaybackControlIds.SEEK_BACKWARD,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_SEEK_BACKWARD_SHOW,
        "playbackControlsSeekBackwardShow",
      ),
      createControlSetting(
        PlaybackControlIds.PREVIOUS,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_PREVIOUS_TRACK_SHOW,
        "playbackControlsPreviousTrackShow",
      ),
      createControlSetting(
        PlaybackControlIds.PLAY_PAUSE,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_PLAY_PAUSE_SHOW,
        "playbackControlsPlayPauseShow",
      ),
      createControlSetting(
        PlaybackControlIds.NEXT,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_NEXT_TRACK_SHOW,
        "playbackControlsNextTrackShow",
      ),
      createControlSetting(
        PlaybackControlIds.SEEK_FORWARD,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_SEEK_FORWARD_SHOW,
        "playbackControlsSeekForwardShow",
      ),
      createControlSetting(
        PlaybackControlIds.REPEAT,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_REPEAT_SHOW,
        "playbackControlsRepeatShow",
      ),
      createControlSetting(
        PlaybackControlIds.SPEED,
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_SPEED_SHOW,
        "playbackControlsSpeedShow",
      ),
    ],
  ),
  [PlaybackControlSurfaces.TOP_BAR]: createSurfaceDefinition(
    {
      settingKey: SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SHOW,
      property: "playbackControlsShow",
    },
    [
      createControlSetting(
        PlaybackControlIds.SHUFFLE,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SHUFFLE_SHOW,
        "playbackControlsShuffleShow",
      ),
      createControlSetting(
        PlaybackControlIds.SEEK_BACKWARD,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SEEK_BACKWARD_SHOW,
        "playbackControlsSeekBackwardShow",
      ),
      createControlSetting(
        PlaybackControlIds.PREVIOUS,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_PREVIOUS_TRACK_SHOW,
        "playbackControlsPreviousTrackShow",
      ),
      createControlSetting(
        PlaybackControlIds.PLAY_PAUSE,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_PLAY_PAUSE_SHOW,
        "playbackControlsPlayPauseShow",
      ),
      createControlSetting(
        PlaybackControlIds.NEXT,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_NEXT_TRACK_SHOW,
        "playbackControlsNextTrackShow",
      ),
      createControlSetting(
        PlaybackControlIds.SEEK_FORWARD,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SEEK_FORWARD_SHOW,
        "playbackControlsSeekForwardShow",
      ),
      createControlSetting(
        PlaybackControlIds.REPEAT,
        SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_REPEAT_SHOW,
        "playbackControlsRepeatShow",
      ),
    ],
  ),
});
