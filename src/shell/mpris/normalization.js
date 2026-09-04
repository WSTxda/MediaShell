/**
 * @file normalization.js
 * @module shell.mpris.normalization
 *
 * Normalizes untrusted MPRIS values into MediaShell-safe domain state.
 *
 * MprisMediaApp feeds raw D-Bus payloads into these helpers before updating cached
 * state. Constants and enums stay imported from their owning domain modules so
 * this file only owns MPRIS value normalization and visibility decisions.
 */

import { MPRIS_NO_TRACK_PATH, MprisMetadataKeys } from "./protocol.js";
import { MediaAppValidity } from "./playerValidity.js";
import { LoopStatus, PlaybackStatus } from "./playbackState.js";

const PLAYBACK_STATUSES = new Set(Object.values(PlaybackStatus));
const LOOP_STATUSES = new Set(Object.values(LoopStatus));
const DBUS_OBJECT_PATH_PATTERN = /^\/(?:[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*)?$/;

/**
 * Returns a concrete MPRIS track object path or null.
 *
 * `/org/mpris/MediaPlayer2/TrackList/NoTrack` is the protocol sentinel for the
 * absence of a current track and is not valid for Player.SetPosition().
 *
 * @param {unknown} value - Raw `mpris:trackid` metadata value.
 * @returns {string|null} Concrete track object path, or null.
 */
export function normalizeMprisTrackId(value) {
  const trackId = typeof value === "string" ? value.trim() : "";
  return trackId &&
    trackId !== MPRIS_NO_TRACK_PATH &&
    DBUS_OBJECT_PATH_PATTERN.test(trackId)
    ? trackId
    : null;
}

/**
 * Normalizes a raw MPRIS PlaybackStatus value.
 *
 * Unknown values fall back to STOPPED so UI never treats unsupported protocol
 * strings as active playback.
 *
 * @param {unknown} value - Raw MPRIS PlaybackStatus value.
 * @returns {string} One of PlaybackStatus.
 */
export function normalizePlaybackStatus(value) {
  return PLAYBACK_STATUSES.has(value) ? value : PlaybackStatus.STOPPED;
}

/**
 * Normalizes a raw MPRIS LoopStatus value.
 *
 * @param {unknown} value - Raw MPRIS LoopStatus value.
 * @returns {string} One of LoopStatus.
 */
export function normalizeLoopStatus(value) {
  return LOOP_STATUSES.has(value) ? value : LoopStatus.NONE;
}

/**
 * Returns whether raw MPRIS metadata contains enough information to represent a track.
 *
 * The MPRIS no-track sentinel must not count as real metadata. Sparse endpoints
 * can still be considered useful when they provide either a title or a concrete
 * track ID.
 *
 * @param {Record<string, unknown>|null|undefined} metadata - Raw metadata map.
 * @returns {boolean} True when metadata represents a usable track.
 */
export function metadataContainsTrack(metadata) {
  if (!metadata || typeof metadata !== "object") return false;

  const trackId = metadata[MprisMetadataKeys.TRACK_ID];
  if (trackId === MPRIS_NO_TRACK_PATH) return false;

  return Boolean(
    metadata[MprisMetadataKeys.TITLE] || normalizeMprisTrackId(trackId),
  );
}

/**
 * Resolves whether an MPRIS-backed media app should be visible.
 *
 * Identity is mandatory because MediaShell needs a stable label/icon fallback.
 * Complete track metadata is preferred, but active playback is accepted while
 * metadata catches up so sparse MPRIS endpoints are not hidden indefinitely.
 *
 * @param {object} state - Normalized identity, metadata, and playback inputs.
 * @returns {string} One of MediaAppValidity.
 */
export function resolveMediaAppValidity({
  hasIdentity,
  hasTrackMetadata,
  hasPresentedTrackMetadata,
  playbackStatus,
}) {
  if (!hasIdentity) return MediaAppValidity.INVALID;
  if (hasTrackMetadata) return MediaAppValidity.VALID;

  // PlaybackStatus is part of the MPRIS player state and can be available
  // before complete metadata arrives. Treat active playback as a usable media
  // session so sparse MPRIS endpoints are not filtered out indefinitely.
  if (normalizePlaybackStatus(playbackStatus) !== PlaybackStatus.STOPPED)
    return MediaAppValidity.VALID;

  return hasPresentedTrackMetadata
    ? MediaAppValidity.EMPTY_STOPPED_GRACE
    : MediaAppValidity.INVALID;
}
