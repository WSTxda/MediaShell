/**
 * @file regions.js
 * @module shell.ui.popup.regions
 *
 * Dirty-region vocabulary owned exclusively by the popup surface.
 *
 * Regions are bitmasks so bursts can be merged cheaply while preserving the
 * granular actor reconciliation used by MediaShell 2.x.
 */

import { PlaybackControlIds } from "../../../shared/playback/controls.js";

export const PopupRegions = Object.freeze({
  MEDIA_APP_SELECTOR: 1 << 0,
  ARTWORK: 1 << 1,
  TRACK_INFORMATION: 1 << 2,
  PROGRESS: 1 << 3,
  PLAYBACK_SHUFFLE: 1 << 4,
  PLAYBACK_PREVIOUS: 1 << 5,
  PLAYBACK_PLAY_PAUSE: 1 << 6,
  PLAYBACK_NEXT: 1 << 7,
  PLAYBACK_REPEAT: 1 << 8,
  PLAYBACK_SEEK_BACKWARD: 1 << 9,
  PLAYBACK_SEEK_FORWARD: 1 << 10,
  PLAYBACK_SPEED: 1 << 11,
  VOLUME: 1 << 12,
  PLAYBACK_CONTROLS:
    (1 << 4) |
    (1 << 5) |
    (1 << 6) |
    (1 << 7) |
    (1 << 8) |
    (1 << 9) |
    (1 << 10) |
    (1 << 11),
  ALL: ~(-1 << 13),
});

export const PopupPlaybackControlRegions = Object.freeze({
  [PlaybackControlIds.SHUFFLE]: PopupRegions.PLAYBACK_SHUFFLE,
  [PlaybackControlIds.SEEK_BACKWARD]: PopupRegions.PLAYBACK_SEEK_BACKWARD,
  [PlaybackControlIds.PREVIOUS]: PopupRegions.PLAYBACK_PREVIOUS,
  [PlaybackControlIds.PLAY_PAUSE]: PopupRegions.PLAYBACK_PLAY_PAUSE,
  [PlaybackControlIds.NEXT]: PopupRegions.PLAYBACK_NEXT,
  [PlaybackControlIds.SEEK_FORWARD]: PopupRegions.PLAYBACK_SEEK_FORWARD,
  [PlaybackControlIds.REPEAT]: PopupRegions.PLAYBACK_REPEAT,
  [PlaybackControlIds.SPEED]: PopupRegions.PLAYBACK_SPEED,
});
