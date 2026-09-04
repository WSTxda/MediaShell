/**
 * @file position.js
 * @module shell.mpris.position
 *
 * Pure playback-position normalization, track identity, and interpolation policy.
 *
 * MprisPositionTracker supplies clock values and D-Bus anchors, while this module
 * performs deterministic calculations that remain testable outside GNOME Shell.
 */

import { MPRIS_NO_TRACK_PATH, MprisMetadataKeys } from "./protocol.js";
import { PlaybackStatus } from "./protocol.js";


/** Maximum age of a local projection before an exact Position refresh is requested. */
export const POSITION_ESTIMATE_MAX_AGE_MICROSECONDS = 30 * 1000 * 1000;

/** Maximum tolerated monotonic/wall-clock divergence before re-anchoring. */
export const POSITION_CLOCK_DRIFT_TOLERANCE_MICROSECONDS = 2 * 1000 * 1000;

function normalizeIdentityValue(value) {
  if (Array.isArray(value))
    return value.map(normalizeIdentityValue).join("\u0000");
  return String(value ?? "").trim();
}

/**
 * Returns a valid track duration or null when the endpoint publishes no usable length.
 *
 * @param {unknown} value - Raw `mpris:length` value.
 * @returns {number|null} Duration in microseconds, or null.
 */
export function normalizeTrackDurationMicroseconds(value) {
  const durationMicroseconds = Number(value);
  if (
    !Number.isFinite(durationMicroseconds) ||
    durationMicroseconds <= 0 ||
    durationMicroseconds > Number.MAX_SAFE_INTEGER
  )
    return null;
  return durationMicroseconds;
}

/**
 * Normalizes and bounds one position anchor.
 *
 * @param {unknown} value - Raw MPRIS position.
 * @param {unknown} durationMicroseconds - Optional track duration.
 * @returns {number} Safe position in microseconds.
 */
export function normalizePlaybackPositionMicroseconds(
  value,
  durationMicroseconds = null,
) {
  const numericPosition = Number(value);
  const positionMicroseconds = Number.isFinite(numericPosition)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, numericPosition))
    : 0;
  const duration = normalizeTrackDurationMicroseconds(durationMicroseconds);
  return duration === null
    ? positionMicroseconds
    : Math.min(duration, positionMicroseconds);
}

/**
 * Normalizes a playback rate used only for local position projection.
 *
 * @param {unknown} value - Raw MPRIS Rate value.
 * @returns {number} Positive playback multiplier.
 */
export function normalizePositionPlaybackRate(value) {
  const playbackRate = Number(value);
  return Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
}

/**
 * Builds the position-specific identity and duration for one metadata payload.
 *
 * A concrete MPRIS track ID is authoritative. Non-compliant sparse endpoints fall
 * back to stable playback fields so artwork or album enrichment cannot reset the
 * progress position for the same track.
 *
 * @param {Record<string, unknown>|null|undefined} metadata - Normalized metadata map.
 * @returns {{identity: string|null, durationMicroseconds: number|null}} Track context.
 */
export function resolvePlaybackPositionTrackContext(metadata) {
  const safeMetadata =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata
      : {};
  const trackId = normalizeIdentityValue(
    safeMetadata[MprisMetadataKeys.TRACK_ID],
  );

  let identity = null;
  if (trackId && trackId !== MPRIS_NO_TRACK_PATH) {
    identity = `track-id:${trackId}`;
  } else {
    const fallbackParts = [
      safeMetadata[MprisMetadataKeys.URL],
      safeMetadata[MprisMetadataKeys.TITLE],
      safeMetadata[MprisMetadataKeys.ARTIST],
    ].map(normalizeIdentityValue);
    if (fallbackParts.some(Boolean))
      identity = `metadata:${fallbackParts.join("\u0001")}`;
  }

  return Object.freeze({
    identity,
    durationMicroseconds: normalizeTrackDurationMicroseconds(
      safeMetadata[MprisMetadataKeys.LENGTH],
    ),
  });
}

/**
 * Projects one anchored MPRIS position without performing I/O.
 *
 * Monotonic time drives interpolation. Real time is only compared with monotonic
 * time to detect suspend or clock discontinuities. A long but clock-consistent
 * projection remains usable for immediate rendering and requests one exact refresh.
 *
 * @param {object} state - Anchor, clock, playback, and track-duration inputs.
 * @returns {{positionMicroseconds: number, shouldRefresh: boolean, clockDiscontinuity: boolean}}
 *   Projected position and refresh policy.
 */
export function resolvePlaybackPositionEstimate({
  positionMicroseconds,
  durationMicroseconds = null,
  playbackStatus,
  playbackRate,
  anchorMonotonicMicroseconds,
  currentMonotonicMicroseconds,
  anchorRealMicroseconds,
  currentRealMicroseconds,
}) {
  const anchorPositionMicroseconds = normalizePlaybackPositionMicroseconds(
    positionMicroseconds,
    durationMicroseconds,
  );
  if (playbackStatus !== PlaybackStatus.PLAYING)
    return Object.freeze({
      positionMicroseconds: anchorPositionMicroseconds,
      shouldRefresh: false,
      clockDiscontinuity: false,
    });

  const monotonicAnchor = Number(anchorMonotonicMicroseconds);
  const monotonicNow = Number(currentMonotonicMicroseconds);
  const realAnchor = Number(anchorRealMicroseconds);
  const realNow = Number(currentRealMicroseconds);
  const elapsedMonotonicMicroseconds = monotonicNow - monotonicAnchor;
  const elapsedRealMicroseconds = realNow - realAnchor;
  const invalidClock =
    !Number.isFinite(elapsedMonotonicMicroseconds) ||
    !Number.isFinite(elapsedRealMicroseconds) ||
    elapsedMonotonicMicroseconds < 0 ||
    elapsedRealMicroseconds < 0;
  const clockDiscontinuity =
    invalidClock ||
    Math.abs(elapsedRealMicroseconds - elapsedMonotonicMicroseconds) >
      POSITION_CLOCK_DRIFT_TOLERANCE_MICROSECONDS;

  if (clockDiscontinuity)
    return Object.freeze({
      positionMicroseconds: anchorPositionMicroseconds,
      shouldRefresh: true,
      clockDiscontinuity: true,
    });

  return Object.freeze({
    positionMicroseconds: normalizePlaybackPositionMicroseconds(
      anchorPositionMicroseconds +
        elapsedMonotonicMicroseconds *
          normalizePositionPlaybackRate(playbackRate),
      durationMicroseconds,
    ),
    shouldRefresh:
      elapsedMonotonicMicroseconds > POSITION_ESTIMATE_MAX_AGE_MICROSECONDS,
    clockDiscontinuity: false,
  });
}
