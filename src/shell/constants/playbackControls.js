/**
 * @file playbackControls.js
 * @module shell.constants.playbackControls
 *
 * Defines Shell-only playback-control layout policy.
 *
 * Shared control descriptors own action identity and icons; this module owns the
 * compact top bar sequence used when actors are reconciled after visibility or
 * settings changes.
 */

import { PlaybackControls } from "../../shared/constants/playbackControls.js";

/** Playback control names in compact top bar display order. */
export const TOP_BAR_PLAYBACK_CONTROL_ORDER = Object.freeze([
  PlaybackControls.SHUFFLE_ON.name,
  PlaybackControls.PREVIOUS.name,
  PlaybackControls.PLAY.name,
  PlaybackControls.NEXT.name,
  PlaybackControls.LOOP_NONE.name,
]);
