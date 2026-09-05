/**
 * @file progress.js
 * @module shell.media.playback.progress
 *
 * Resolves canonical progress values shared by MediaShell progress surfaces.
 *
 * MPRIS position tracking remains authoritative for time projection. This module
 * only validates one rendered snapshot and derives the normalized slider/timeline
 * values needed by popup and native controls presentations.
 */

import {
  normalizePositionPlaybackRate,
  normalizeTrackDurationMicroseconds,
} from "../../mpris/position.js";

export function resolvePlaybackProgress(
  positionMicroseconds,
  durationMicroseconds,
  playbackRate,
) {
  const duration = normalizeTrackDurationMicroseconds(durationMicroseconds);
  const position = Number(positionMicroseconds);
  if (duration === null || !Number.isFinite(position) || position < 0)
    return null;

  const boundedPosition = Math.min(position, duration);
  const rate = normalizePositionPlaybackRate(playbackRate);
  const durationMilliseconds = Math.max(1, duration / 1000);
  const positionMilliseconds = Math.min(
    durationMilliseconds,
    Math.max(0, boundedPosition / 1000),
  );
  const timelineDurationMilliseconds = Math.max(
    1,
    Math.round(durationMilliseconds / rate),
  );
  const timelinePositionMilliseconds = Math.min(
    timelineDurationMilliseconds,
    positionMilliseconds / rate,
  );

  return Object.freeze({
    positionMicroseconds: boundedPosition,
    durationMicroseconds: duration,
    playbackRate: rate,
    fraction: Math.min(1, positionMilliseconds / durationMilliseconds),
    timelineDurationMilliseconds,
    timelinePositionMilliseconds,
  });
}
