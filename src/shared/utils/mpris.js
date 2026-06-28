/**
 * @file mpris.js
 * @module shared.utils.mpris
 *
 * Normalizes untrusted MPRIS values into MediaShell-safe domain state.
 *
 * PlayerProxy feeds raw DBus payloads into these helpers before updating cached
 * state. Compatibility re-exports keep constants and enums available from the
 * historical import path until an intentional cleanup removes them.
 */

import { MPRIS_NO_TRACK_PATH } from "../constants/dbus.js";
import { MediaAppValidity } from "../enums/app.js";
import { LoopStatus, PlaybackStatus } from "../enums/playback.js";

// Compatibility re-exports for legacy imports; new code should import MPRIS_NO_TRACK_PATH from constants/dbus.js
// and MediaAppValidity from enums/app.js directly
export { MPRIS_NO_TRACK_PATH, MediaAppValidity };

const PLAYBACK_STATUSES = new Set(Object.values(PlaybackStatus));
const LOOP_STATUSES = new Set(Object.values(LoopStatus));

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

    const trackId = metadata["mpris:trackid"];
    if (trackId === MPRIS_NO_TRACK_PATH) return false;

    return Boolean(metadata["xesam:title"] || trackId);
}

/**
 * Resolves whether a PlayerProxy should be visible as a media app.
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

    return hasPresentedTrackMetadata ? MediaAppValidity.EMPTY_STOPPED_GRACE : MediaAppValidity.INVALID;
}
