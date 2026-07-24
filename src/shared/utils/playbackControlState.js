/**
 * @file playbackControlState.js
 * @module shared.utils.playbackControlState
 *
 * Resolves the semantic play, pause, or stop action for a normalized media-app state.
 *
 * popup and top bar playback controls use this pure helper so they choose the
 * same primary playback action for playing, paused, stopped, and non-pausable
 * MPRIS endpoints while keeping their actor layout separate.
 */

import { PlaybackControls } from "../constants/playbackControls.js";
import { LoopStatus, PlaybackStatus } from "../enums/playback.js";

/**
 * Selects the primary playback control for a media app.
 *
 * MPRIS apps that are not playing should offer Play when possible. Playing apps
 * normally offer Pause, but endpoints that can control playback while lacking
 * `CanPause` fall back to Stop. Returning the action callback with the descriptor
 * keeps popup and top bar behavior identical without sharing button actors.
 *
 * @param {object} mediaApp - Normalized PlayerProxy-like media app state.
 * @returns {{control: object, isReactive: boolean, action: Function}} Button descriptor, sensitivity, and action.
 */
export function resolvePlayPauseControl(mediaApp) {
  if (mediaApp.playbackStatus !== PlaybackStatus.PLAYING) {
    return {
      control: PlaybackControls.PLAY,
      isReactive: mediaApp.canPlay && mediaApp.canControl,
      action: () => mediaApp.play(),
    };
  }

  if (mediaApp.canControl && !mediaApp.canPause) {
    return {
      control: PlaybackControls.STOP,
      isReactive: mediaApp.canControl,
      action: () => mediaApp.stop(),
    };
  }

  return {
    control: PlaybackControls.PAUSE,
    isReactive: mediaApp.canPause && mediaApp.canControl,
    action: () => mediaApp.pause(),
  };
}

/**
 * Selects the repeat control and active state for a media app.
 *
 * @param {object} mediaApp - Normalized PlayerProxy-like media app state.
 * @returns {{control: object, isReactive: boolean, isActive: boolean, action: Function}} Repeat button state.
 */
export function resolveLoopControl(mediaApp) {
  const control =
    mediaApp.loopStatus === LoopStatus.NONE
      ? PlaybackControls.LOOP_NONE
      : mediaApp.loopStatus === LoopStatus.TRACK
        ? PlaybackControls.LOOP_TRACK
        : PlaybackControls.LOOP_PLAYLIST;

  return {
    control,
    isReactive: mediaApp.canControl,
    isActive: control !== PlaybackControls.LOOP_NONE,
    action: () => mediaApp.toggleLoop(),
  };
}

/**
 * Selects the shuffle control and active state for a media app.
 *
 * @param {object} mediaApp - Normalized PlayerProxy-like media app state.
 * @returns {{control: object, isReactive: boolean, isActive: boolean, action: Function}} Shuffle button state.
 */
export function resolveShuffleControl(mediaApp) {
  return {
    control: mediaApp.shuffle
      ? PlaybackControls.SHUFFLE_ON
      : PlaybackControls.SHUFFLE_OFF,
    isReactive: mediaApp.canControl,
    isActive: Boolean(mediaApp.shuffle),
    action: () => mediaApp.toggleShuffle(),
  };
}
