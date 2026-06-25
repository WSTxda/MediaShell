/**
 * @file playback.js
 * @module shared.enums.playback
 *
 * Enum values for normalized MPRIS playback and loop states.
 *
 * PlayerProxy converts raw MPRIS strings into these constants before UI code sees
 * them. Top-bar and popup controls use the normalized states to decide button
 * sensitivity, play/pause icons, and repeat-mode toggles.
 */
export const PlaybackStatus = Object.freeze({
    PLAYING: "Playing",
    PAUSED: "Paused",
    STOPPED: "Stopped",
});

export const LoopStatus = Object.freeze({
    NONE: "None",
    TRACK: "Track",
    PLAYLIST: "Playlist",
});
