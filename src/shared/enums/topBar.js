/**
 * @file topBar.js
 * @module shared.enums.topBar
 *
 * Enum values for top-bar placement and element identity.
 *
 * Preferences widgets and TopBarButton rely on these stable IDs to preserve the
 * user's chosen position and element order. Keep this file limited to values that
 * describe the top-bar surface itself; track-information and visualizer enums
 * live in their own domain files.
 */

export const TopBarPositions = Object.freeze({
    LEFT: "left",
    CENTER: "center",
    RIGHT: "right",
});

export const TopBarElements = Object.freeze({
    APP_ICON: 0,
    TRACK_INFORMATION: 1,
    PLAYBACK_CONTROLS: 2,
    VISUALIZER: 3,
});
