/**
 * @file regions.js
 * @module shell.ui.topbar.regions
 *
 * Dirty-region vocabulary owned exclusively by the top-bar surface.
 */

import { PlaybackControlIds } from "../../../shared/playback/controls.js";

export const TopBarRegions = Object.freeze({
  APP_ICON: 1 << 0,
  ARTWORK: 1 << 1,
  TRACK_INFORMATION: 1 << 2,
  PLAYBACK_SHUFFLE: 1 << 3,
  PLAYBACK_PREVIOUS: 1 << 4,
  PLAYBACK_PLAY_PAUSE: 1 << 5,
  PLAYBACK_NEXT: 1 << 6,
  PLAYBACK_REPEAT: 1 << 7,
  VISUALIZER: 1 << 8,
  PLAYBACK_SEEK_BACKWARD: 1 << 9,
  PLAYBACK_SEEK_FORWARD: 1 << 10,
  LAYOUT: 1 << 11,
  ELEMENT_ORDER: 1 << 12,
  PLAYBACK_CONTROLS:
    (1 << 3) |
    (1 << 4) |
    (1 << 5) |
    (1 << 6) |
    (1 << 7) |
    (1 << 9) |
    (1 << 10),
  CONTENT:
    (1 << 0) |
    (1 << 1) |
    (1 << 2) |
    (1 << 3) |
    (1 << 4) |
    (1 << 5) |
    (1 << 6) |
    (1 << 7) |
    (1 << 8) |
    (1 << 9) |
    (1 << 10),
  ALL: ~(-1 << 13),
});

export const TopBarPlaybackControlRegions = Object.freeze({
  [PlaybackControlIds.SHUFFLE]: TopBarRegions.PLAYBACK_SHUFFLE,
  [PlaybackControlIds.SEEK_BACKWARD]: TopBarRegions.PLAYBACK_SEEK_BACKWARD,
  [PlaybackControlIds.PREVIOUS]: TopBarRegions.PLAYBACK_PREVIOUS,
  [PlaybackControlIds.PLAY_PAUSE]: TopBarRegions.PLAYBACK_PLAY_PAUSE,
  [PlaybackControlIds.NEXT]: TopBarRegions.PLAYBACK_NEXT,
  [PlaybackControlIds.SEEK_FORWARD]: TopBarRegions.PLAYBACK_SEEK_FORWARD,
  [PlaybackControlIds.REPEAT]: TopBarRegions.PLAYBACK_REPEAT,
});
