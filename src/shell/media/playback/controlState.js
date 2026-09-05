/**
 * @file controlState.js
 * @module shell.media.playback.controlState
 *
 * Resolves one logical playback control into pure presentation and action data.
 *
 * Popup and top bar consume the same result while retaining separate actors and
 * styling. The resolver never captures a live MprisPlayer in a callback; Shell
 * execution is delegated to the PlaybackController.
 */

import {
  PlaybackControlActions,
  PlaybackControlDefinitions,
  PlaybackControlIds,
} from "../../../shared/playback/controls.js";
import { LoopStatus, PlaybackStatus } from "../../mpris/protocol.js";
import {
  canChangePlaybackRate,
  formatPlaybackRate,
} from "../../mpris/playbackRate.js";

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

function resolvePlayPauseState(player) {
  const control = PlaybackControlDefinitions.PLAY_PAUSE;

  if (player.playbackStatus !== PlaybackStatus.PLAYING) {
    return createControlState(
      control,
      control.icons.PLAY,
      player.canPlay && player.canControl,
      PlaybackControlActions.PLAY,
    );
  }

  if (player.canControl && !player.canPause) {
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
    player.canPause && player.canControl,
    PlaybackControlActions.PAUSE,
  );
}

function resolveRepeatState(player) {
  const control = PlaybackControlDefinitions.REPEAT;
  const isTrack = player.loopStatus === LoopStatus.TRACK;
  const isPlaylist = player.loopStatus === LoopStatus.PLAYLIST;
  const iconName = isTrack
    ? control.icons.TRACK
    : isPlaylist
      ? control.icons.PLAYLIST
      : control.icons.NONE;

  return createControlState(
    control,
    iconName,
    player.canControl && player.canSetLoopStatus,
    PlaybackControlActions.TOGGLE_REPEAT,
    isTrack || isPlaylist,
  );
}

function resolveShuffleState(player) {
  const control = PlaybackControlDefinitions.SHUFFLE;
  const isActive = Boolean(player.shuffle);

  return createControlState(
    control,
    isActive ? control.icons.ON : control.icons.OFF,
    player.canControl && player.canSetShuffle,
    PlaybackControlActions.TOGGLE_SHUFFLE,
    isActive,
  );
}

function resolveSpeedState(player) {
  const control = PlaybackControlDefinitions.SPEED;
  return createControlState(
    control,
    null,
    player.canControl &&
      player.canSetPlaybackRate &&
      canChangePlaybackRate(player.minimumRate, player.maximumRate),
    PlaybackControlActions.CYCLE_SPEED,
    false,
    formatPlaybackRate(player.rate),
  );
}

/**
 * Resolves one logical playback control for a normalized player state.
 *
 * @param {object} player - Normalized player state.
 * @param {string} controlId - One value from PlaybackControlIds.
 * @returns {{control: object, iconName: string|null, labelText: string,
 *   isReactive: boolean, isActive: boolean, action: string}} Pure control state.
 * @throws {TypeError} When an unknown logical control ID is supplied.
 */
export function resolvePlaybackControlState(player, controlId) {
  switch (controlId) {
    case PlaybackControlIds.SHUFFLE:
      return resolveShuffleState(player);
    case PlaybackControlIds.SEEK_BACKWARD: {
      const control = PlaybackControlDefinitions.SEEK_BACKWARD;
      return createControlState(
        control,
        control.icons.DEFAULT,
        player.canSeek && player.canControl,
        PlaybackControlActions.SEEK_BACKWARD,
      );
    }
    case PlaybackControlIds.PREVIOUS: {
      const control = PlaybackControlDefinitions.PREVIOUS;
      return createControlState(
        control,
        control.icons.DEFAULT,
        player.canGoPrevious && player.canControl,
        PlaybackControlActions.PREVIOUS,
      );
    }
    case PlaybackControlIds.PLAY_PAUSE:
      return resolvePlayPauseState(player);
    case PlaybackControlIds.NEXT: {
      const control = PlaybackControlDefinitions.NEXT;
      return createControlState(
        control,
        control.icons.DEFAULT,
        player.canGoNext && player.canControl,
        PlaybackControlActions.NEXT,
      );
    }
    case PlaybackControlIds.SEEK_FORWARD: {
      const control = PlaybackControlDefinitions.SEEK_FORWARD;
      return createControlState(
        control,
        control.icons.DEFAULT,
        player.canSeek && player.canControl,
        PlaybackControlActions.SEEK_FORWARD,
      );
    }
    case PlaybackControlIds.REPEAT:
      return resolveRepeatState(player);
    case PlaybackControlIds.SPEED:
      return resolveSpeedState(player);
    default:
      throw new TypeError(`Unknown playback control: ${String(controlId)}`);
  }
}
