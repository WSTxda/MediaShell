// Normalizes untrusted MPRIS values without importing GI toolkits.
import { LoopStatus, PlaybackStatus } from "../enums/MediaShellEnums.js";

export const MPRIS_NO_TRACK_PATH = "/org/mpris/MediaPlayer2/TrackList/NoTrack";

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
