/**
 * @file controlState.js
 * @module shell.media.playback.controlState
 *
 * Resolves one logical playback control into pure presentation and action data.
 *
 * Popup and top bar consume the same result while retaining separate actors and
 * styling. The resolver never captures a live MprisMediaApp in a callback; Shell
 * execution is delegated to the playback-control executor.
 */

import {
  PlaybackControlActions,
  PlaybackControlDefinitions,
  PlaybackControlIds,
} from "../../../shared/playback/controls.js";
import { LoopStatus, PlaybackStatus } from "../../mpris/playbackState.js";
import { canChangePlaybackRate, formatPlaybackRate } from "../../mpris/playbackRate.js";

function createControlState(
  control,
  iconName,
  isReactive,
  action,
  isActive = false,
  labelText = "",
) {
  return {
    control,
    iconName,
    labelText: String(labelText ?? ""),
    isReactive: Boolean(isReactive),
    isActive: Boolean(isActive),
    action,
  };
}

function resolvePlayPauseState(mediaApp) {
  const control = PlaybackControlDefinitions.PLAY_PAUSE;

  if (mediaApp.playbackStatus !== PlaybackStatus.PLAYING) {
    return createControlState(
      control,
      control.icons.PLAY,
      mediaApp.canPlay && mediaApp.canControl,
      PlaybackControlActions.PLAY,
    );
  }

  if (mediaApp.canControl && !mediaApp.canPause) {
    return createControlState(
      control,
      control.icons.STOP,
      true,
      PlaybackControlActions.STOP,
    );
  }

  return createControlState(
    control,
    control.icons.PAUSE,
    mediaApp.canPause && mediaApp.canControl,
    PlaybackControlActions.PAUSE,
  );
}

function resolveRepeatState(mediaApp) {
  const control = PlaybackControlDefinitions.REPEAT;
  const isTrack = mediaApp.loopStatus === LoopStatus.TRACK;
  const isPlaylist = mediaApp.loopStatus === LoopStatus.PLAYLIST;
  const iconName = isTrack
    ? control.icons.TRACK
    : isPlaylist
      ? control.icons.PLAYLIST
      : control.icons.NONE;

  return createControlState(
    control,
    iconName,
    mediaApp.canControl && mediaApp.canSetLoopStatus,
    PlaybackControlActions.TOGGLE_REPEAT,
    isTrack || isPlaylist,
  );
}

function resolveShuffleState(mediaApp) {
  const control = PlaybackControlDefinitions.SHUFFLE;
  const isActive = Boolean(mediaApp.shuffle);

  return createControlState(
    control,
    isActive ? control.icons.ON : control.icons.OFF,
    mediaApp.canControl && mediaApp.canSetShuffle,
    PlaybackControlActions.TOGGLE_SHUFFLE,
    isActive,
  );
}

function resolveSpeedState(mediaApp) {
  const control = PlaybackControlDefinitions.SPEED;
  return createControlState(
    control,
    null,
    mediaApp.canControl &&
      mediaApp.canSetPlaybackRate &&
      canChangePlaybackRate(mediaApp.minimumRate, mediaApp.maximumRate),
    PlaybackControlActions.CYCLE_SPEED,
    false,
    formatPlaybackRate(mediaApp.rate),
  );
}

/**
 * Resolves one logical playback control for a normalized media-app state.
 *
 * @param {object} mediaApp - Normalized media-app state.
 * @param {string} controlId - One value from PlaybackControlIds.
 * @returns {{control: object, iconName: string|null, labelText: string,
 *   isReactive: boolean, isActive: boolean, action: string}} Pure control state.
 * @throws {TypeError} When an unknown logical control ID is supplied.
 */
export function resolvePlaybackControlState(mediaApp, controlId) {
  switch (controlId) {
    case PlaybackControlIds.SHUFFLE:
      return resolveShuffleState(mediaApp);
    case PlaybackControlIds.SEEK_BACKWARD: {
      const control = PlaybackControlDefinitions.SEEK_BACKWARD;
      return createControlState(
        control,
        control.icons.DEFAULT,
        mediaApp.canSeek && mediaApp.canControl,
        PlaybackControlActions.SEEK_BACKWARD,
      );
    }
    case PlaybackControlIds.PREVIOUS: {
      const control = PlaybackControlDefinitions.PREVIOUS;
      return createControlState(
        control,
        control.icons.DEFAULT,
        mediaApp.canGoPrevious && mediaApp.canControl,
        PlaybackControlActions.PREVIOUS,
      );
    }
    case PlaybackControlIds.PLAY_PAUSE:
      return resolvePlayPauseState(mediaApp);
    case PlaybackControlIds.NEXT: {
      const control = PlaybackControlDefinitions.NEXT;
      return createControlState(
        control,
        control.icons.DEFAULT,
        mediaApp.canGoNext && mediaApp.canControl,
        PlaybackControlActions.NEXT,
      );
    }
    case PlaybackControlIds.SEEK_FORWARD: {
      const control = PlaybackControlDefinitions.SEEK_FORWARD;
      return createControlState(
        control,
        control.icons.DEFAULT,
        mediaApp.canSeek && mediaApp.canControl,
        PlaybackControlActions.SEEK_FORWARD,
      );
    }
    case PlaybackControlIds.REPEAT:
      return resolveRepeatState(mediaApp);
    case PlaybackControlIds.SPEED:
      return resolveSpeedState(mediaApp);
    default:
      throw new TypeError(`Unknown playback control: ${String(controlId)}`);
  }
}
