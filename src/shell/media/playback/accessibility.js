/**
 * @file accessibility.js
 * @module shell.media.playback.accessibility
 *
 * Resolves concise accessible names for canonical playback controls.
 *
 * The module stays GI- and resource-free by receiving gettext as a callback.
 * Popup and top bar therefore expose identical state wording without moving
 * Shell translation concerns into shared code.
 */

import {
  PlaybackControlActions,
  PlaybackControlIds,
  RELATIVE_SEEK_SECONDS,
} from "../../../shared/playback/controls.js";
import { LoopStatus } from "../../mpris/protocol.js";

function withDetail(label, detail) {
  const normalizedDetail = String(detail ?? "").trim();
  return normalizedDetail ? `${label}: ${normalizedDetail}` : label;
}

/**
 * Resolves the assistive-technology name for one playback control.
 *
 * @param {object} mediaApp - Normalized media-app state.
 * @param {object} controlState - Result from resolvePlaybackControlState().
 * @param {(message: string) => string} _ - Translation function.
 * @returns {string} Localized accessible name.
 */
export function resolvePlaybackControlAccessibleName(
  mediaApp,
  controlState,
  _ = (message) => message,
) {
  const { control, action, labelText } = controlState;

  switch (control.id) {
    case PlaybackControlIds.SHUFFLE:
      return _("Shuffle");
    case PlaybackControlIds.SEEK_BACKWARD:
      return withDetail(_("Seek backward"), `${RELATIVE_SEEK_SECONDS} s`);
    case PlaybackControlIds.PREVIOUS:
      return _("Previous track");
    case PlaybackControlIds.PLAY_PAUSE:
      if (action === PlaybackControlActions.PLAY) return _("Play");
      if (action === PlaybackControlActions.PAUSE) return _("Pause");
      if (action === PlaybackControlActions.STOP) return _("Stop");
      return _("Play / pause");
    case PlaybackControlIds.NEXT:
      return _("Next track");
    case PlaybackControlIds.SEEK_FORWARD:
      return withDetail(_("Seek forward"), `${RELATIVE_SEEK_SECONDS} s`);
    case PlaybackControlIds.REPEAT: {
      const repeatMode =
        mediaApp.loopStatus === LoopStatus.TRACK
          ? _("Track")
          : mediaApp.loopStatus === LoopStatus.PLAYLIST
            ? _("Playlist")
            : _("None");
      return withDetail(_("Repeat"), repeatMode);
    }
    case PlaybackControlIds.SPEED:
      return withDetail(_("Playback speed"), labelText);
    default:
      return String(control.actorName ?? control.id);
  }
}
