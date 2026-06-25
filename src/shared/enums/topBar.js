/**
 * @file topBar.js
 * @module shared.enums.topBar
 *
 * Enum values for top-bar position, element identity, and visualizer styles.
 *
 * Settings migration, preferences widgets, and TopBarButton all rely on these
 * stable IDs to preserve user-configured order and presentation. Element values
 * correspond to runtime widgets created inside the top-bar actor.
 */
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
