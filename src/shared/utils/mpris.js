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

export function normalizePlaybackStatus(value) {
    return PLAYBACK_STATUSES.has(value) ? value : PlaybackStatus.STOPPED;
}

export function normalizeLoopStatus(value) {
    return LOOP_STATUSES.has(value) ? value : LoopStatus.NONE;
}

export function metadataContainsTrack(metadata) {
    if (!metadata || typeof metadata !== "object") return false;

    const trackId = metadata["mpris:trackid"];
    if (trackId === MPRIS_NO_TRACK_PATH) return false;

    return Boolean(metadata["xesam:title"] || trackId);
}

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
    // session so sparse players are not filtered out indefinitely.
    if (normalizePlaybackStatus(playbackStatus) !== PlaybackStatus.STOPPED)
        return MediaAppValidity.VALID;

    return hasPresentedTrackMetadata ? MediaAppValidity.EMPTY_STOPPED_GRACE : MediaAppValidity.INVALID;
}
