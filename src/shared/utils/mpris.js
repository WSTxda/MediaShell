// Normalizes untrusted MPRIS values without importing GI toolkits.
import { LoopStatus, PlaybackStatus } from "../enums/MediaShellEnums.js";

export const MPRIS_NO_TRACK_PATH = "/org/mpris/MediaPlayer2/TrackList/NoTrack";

export const MediaAppValidity = Object.freeze({
    INVALID: "invalid",
    VALID: "valid",
    EMPTY_STOPPED_GRACE: "empty-stopped-grace",
});

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
