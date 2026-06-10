// Defines immutable domain values shared across Shell and preferences without toolkit imports.
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

export const TopBarPositions = Object.freeze({
    LEFT: "left",
    CENTER: "center",
    RIGHT: "right",
});

export const TrackInformationFields = Object.freeze({
    ARTIST: "Artist",
    TITLE: "Title",
    ALBUM: "Album",
    DISC_NUMBER: "Disc Number",
    TRACK_NUMBER: "Track Number",
});

export const TopBarElements = Object.freeze({
    APP_ICON: 0,
    TRACK_INFORMATION: 1,
    PLAYBACK_CONTROLS: 2,
    VISUALIZER: 3,
});

export const VisualizerStyles = Object.freeze({
    WAVE: 0,
    PULSE: 1,
});

export const InputActions = Object.freeze({
    NONE: 0,
    PLAY_PAUSE: 1,
    NEXT_TRACK: 2,
    PREVIOUS_TRACK: 3,
    VOLUME_UP: 4,
    VOLUME_DOWN: 5,
    TOGGLE_LOOP: 6,
    TOGGLE_SHUFFLE: 7,
    TOGGLE_POPUP: 8,
    RAISE_APP: 9,
    QUIT_APP: 10,
    OPEN_PREFERENCES: 11,
    NEXT_APP: 12,
});

export const WidgetFlags = Object.freeze({
    TOP_BAR_APP_ICON: 1 << 0,
    TOP_BAR_TRACK_INFORMATION: 1 << 1,
    TOP_BAR_PLAYBACK_PREVIOUS: 1 << 2,
    TOP_BAR_PLAYBACK_PLAY_PAUSE: 1 << 3,
    TOP_BAR_PLAYBACK_NEXT: 1 << 4,
    TOP_BAR_PLAYBACK_CONTROLS: (1 << 2) | (1 << 3) | (1 << 4),
    TOP_BAR: (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 15),
    TOP_BAR_ELEMENT_ORDER: 1 << 5,
    POPUP_APP_SELECTOR: 1 << 6,
    POPUP_ALBUM_ART: 1 << 7,
    POPUP_TRACK_INFORMATION: 1 << 8,
    POPUP_PLAYBACK_PROGRESS: 1 << 9,
    POPUP_PLAYBACK_LOOP: 1 << 10,
    POPUP_PLAYBACK_PREVIOUS: 1 << 11,
    POPUP_PLAYBACK_PLAY_PAUSE: 1 << 12,
    POPUP_PLAYBACK_NEXT: 1 << 13,
    POPUP_PLAYBACK_SHUFFLE: 1 << 14,
    TOP_BAR_VISUALIZER: 1 << 15,
    POPUP_PLAYBACK_CONTROLS: (1 << 10) | (1 << 11) | (1 << 12) | (1 << 13) | (1 << 14),
    POPUP: (1 << 6) | (1 << 7) | (1 << 8) | (1 << 9) | (1 << 10) | (1 << 11) | (1 << 12) | (1 << 13) | (1 << 14),
    ALL: ~(-1 << 16),
});
