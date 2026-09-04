/**
 * @file surfaceUpdates.js
 * @module shell.media.playback.surfaceUpdates
 *
 * Maps playback-control settings to Shell UI invalidation regions.
 *
 * The cross-process surface contract intentionally contains only stable control
 * and settings ownership. WidgetFlags are Shell presentation details, so their
 * mapping lives here and can be replaced by the v3 surface reconcilers without
 * leaking Shell UI state back into shared code.
 */

import { PlaybackControlIds } from "../../../shared/playback/controls.js";
import { PlaybackControlSurfaces } from "../../../shared/playback/surfaces.js";
import { WidgetFlags } from "../../ui/widgetFlags.js";

export const PlaybackControlSurfaceUpdates = Object.freeze({
  [PlaybackControlSurfaces.POPUP]: Object.freeze({
    show: WidgetFlags.POPUP_PLAYBACK_CONTROLS,
    controls: Object.freeze({
      [PlaybackControlIds.SHUFFLE]: WidgetFlags.POPUP_PLAYBACK_SHUFFLE,
      [PlaybackControlIds.SEEK_BACKWARD]:
        WidgetFlags.POPUP_PLAYBACK_SEEK_BACKWARD,
      [PlaybackControlIds.PREVIOUS]: WidgetFlags.POPUP_PLAYBACK_PREVIOUS,
      [PlaybackControlIds.PLAY_PAUSE]: WidgetFlags.POPUP_PLAYBACK_PLAY_PAUSE,
      [PlaybackControlIds.NEXT]: WidgetFlags.POPUP_PLAYBACK_NEXT,
      [PlaybackControlIds.SEEK_FORWARD]: WidgetFlags.POPUP_PLAYBACK_SEEK_FORWARD,
      [PlaybackControlIds.REPEAT]: WidgetFlags.POPUP_PLAYBACK_REPEAT,
      [PlaybackControlIds.SPEED]: WidgetFlags.POPUP_PLAYBACK_SPEED,
    }),
  }),
  [PlaybackControlSurfaces.TOP_BAR]: Object.freeze({
    show: WidgetFlags.TOP_BAR_PLAYBACK_CONTROLS,
    controls: Object.freeze({
      [PlaybackControlIds.SHUFFLE]: WidgetFlags.TOP_BAR_PLAYBACK_SHUFFLE,
      [PlaybackControlIds.SEEK_BACKWARD]:
        WidgetFlags.TOP_BAR_PLAYBACK_SEEK_BACKWARD,
      [PlaybackControlIds.PREVIOUS]: WidgetFlags.TOP_BAR_PLAYBACK_PREVIOUS,
      [PlaybackControlIds.PLAY_PAUSE]: WidgetFlags.TOP_BAR_PLAYBACK_PLAY_PAUSE,
      [PlaybackControlIds.NEXT]: WidgetFlags.TOP_BAR_PLAYBACK_NEXT,
      [PlaybackControlIds.SEEK_FORWARD]: WidgetFlags.TOP_BAR_PLAYBACK_SEEK_FORWARD,
      [PlaybackControlIds.REPEAT]: WidgetFlags.TOP_BAR_PLAYBACK_REPEAT,
    }),
  }),
});

export function getPlaybackControlSurfaceUpdates(surface) {
  const updates = PlaybackControlSurfaceUpdates[surface];
  if (!updates)
    throw new TypeError(`Unknown playback control surface: ${String(surface)}`);
  return updates;
}
