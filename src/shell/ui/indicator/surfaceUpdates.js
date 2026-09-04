/**
 * @file surfaceUpdates.js
 * @module shell.ui.indicator.surfaceUpdates
 *
 * Translates player state changes into independent popup/top-bar dirty regions.
 *
 * This is the only cross-surface routing vocabulary used by the indicator. Each
 * surface still owns its region values, queue, reconciliation, and lifecycle.
 */

import { createSurfaceUpdate } from "../reconciliation/surfaceUpdate.js";
import { PopupRegions } from "../popup/regions.js";
import { TopBarRegions } from "../topbar/regions.js";

export const PlayerSurfaceUpdates = Object.freeze({
  ALL: createSurfaceUpdate({
    popup: PopupRegions.ALL,
    topBar: TopBarRegions.ALL,
  }),
  IDENTITY: createSurfaceUpdate({
    popup: PopupRegions.MEDIA_APP_SELECTOR,
    topBar: TopBarRegions.MEDIA_APP_ICON,
  }),
  PLAYBACK_STATUS: createSurfaceUpdate({
    popup: PopupRegions.PLAYBACK_PLAY_PAUSE | PopupRegions.PROGRESS,
    topBar: TopBarRegions.PLAYBACK_PLAY_PAUSE | TopBarRegions.VISUALIZER,
  }),
  PLAY_PAUSE_CAPABILITY: createSurfaceUpdate({
    popup: PopupRegions.PLAYBACK_PLAY_PAUSE,
    topBar: TopBarRegions.PLAYBACK_PLAY_PAUSE,
  }),
  SEEK_CAPABILITY: createSurfaceUpdate({
    popup:
      PopupRegions.PROGRESS |
      PopupRegions.PLAYBACK_SEEK_BACKWARD |
      PopupRegions.PLAYBACK_SEEK_FORWARD,
    topBar:
      TopBarRegions.PLAYBACK_SEEK_BACKWARD |
      TopBarRegions.PLAYBACK_SEEK_FORWARD,
  }),
  NEXT_CAPABILITY: createSurfaceUpdate({
    popup: PopupRegions.PLAYBACK_NEXT,
    topBar: TopBarRegions.PLAYBACK_NEXT,
  }),
  PREVIOUS_CAPABILITY: createSurfaceUpdate({
    popup: PopupRegions.PLAYBACK_PREVIOUS,
    topBar: TopBarRegions.PLAYBACK_PREVIOUS,
  }),
  CONTROL_CAPABILITY: createSurfaceUpdate({
    popup:
      PopupRegions.PLAYBACK_CONTROLS |
      PopupRegions.PROGRESS |
      PopupRegions.VOLUME,
    topBar: TopBarRegions.PLAYBACK_CONTROLS,
  }),
  SHUFFLE: createSurfaceUpdate({
    popup: PopupRegions.PLAYBACK_SHUFFLE,
    topBar: TopBarRegions.PLAYBACK_SHUFFLE,
  }),
  LOOP_STATUS: createSurfaceUpdate({
    popup: PopupRegions.PLAYBACK_REPEAT,
    topBar: TopBarRegions.PLAYBACK_REPEAT,
  }),
  VOLUME: createSurfaceUpdate({ popup: PopupRegions.VOLUME }),
  PIN: createSurfaceUpdate({ popup: PopupRegions.MEDIA_APP_SELECTOR }),
  RATE: createSurfaceUpdate({ popup: PopupRegions.PLAYBACK_SPEED }),
});

export function createMetadataSurfaceUpdate(includePopupProgress) {
  return createSurfaceUpdate({
    popup:
      PopupRegions.ARTWORK |
      PopupRegions.TRACK_INFORMATION |
      (includePopupProgress ? PopupRegions.PROGRESS : 0),
    topBar: TopBarRegions.ARTWORK | TopBarRegions.TRACK_INFORMATION,
  });
}
