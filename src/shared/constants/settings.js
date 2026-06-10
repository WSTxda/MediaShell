// Defines shared setting names and validated numeric bounds used by Shell and preferences.
export const ALBUM_ART_CACHE_DIRECTORY_NAME = "mediashell@wstxda.github.com";

export const TOP_BAR_ELEMENT_ORDER_DEFAULT = Object.freeze([
    "APP_ICON",
    "TRACK_INFORMATION",
    "VISUALIZER",
    "PLAYBACK_CONTROLS",
]);

export const TOP_BAR_TRACK_INFORMATION_WIDTH = Object.freeze({
    MIN: 0,
    MAX: 1000,
    DEFAULT: 200,
});

export const TEXT_SCROLL_SPEED = Object.freeze({
    MIN: 1,
    MAX: 10,
    DEFAULT: 4,
});

export const TOP_BAR_VISUALIZER_SPEED = Object.freeze({
    MIN: 1,
    MAX: 8,
    DEFAULT: 4,
});

export const TEXT_SCROLL_PAUSE_SECONDS = Object.freeze({
    MIN: 0,
    MAX: 10,
    DEFAULT: 0,
});

export const POPUP_WIDTH = Object.freeze({
    MIN: 250,
    MAX: 500,
    DEFAULT: 250,
});

export const POPUP_ALBUM_ART_CORNER_RADIUS = Object.freeze({
    MIN: 0,
    MAX: 50,
    DEFAULT: 20,
});

export const TOP_BAR_INDEX = Object.freeze({
    MIN: 0,
    MAX: 100,
    DEFAULT: 0,
});
