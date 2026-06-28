/**
 * @file SettingsMigration.js
 * @module shared.settings.SettingsMigration
 *
 * Migrates historical MediaShell settings to the current schema version.
 *
 * The migration runner copies legacy keys only when the destination does not
 * already contain a user value, then advances the schema-version marker. Tests
 * cover each historical boundary to guarantee idempotency and enum preservation.
 */

export const SETTINGS_SCHEMA_VERSION = 9;
const SETTINGS_SCHEMA_VERSION_KEY = "settings-schema-version";

export const LEGACY_SETTING_KEY_MIGRATIONS = Object.freeze({
    "label-width": "top-bar-track-information-width",
    "fixed-label-width": "lock-top-bar-track-information-width",
    "scroll-labels": "top-bar-scroll-track-information",
    "scroll-speed": "top-bar-scroll-speed",
    "scroll-pause-time": "top-bar-scroll-pause-time",
    "popup-scroll-labels": "popup-scroll-track-information",
    "hide-media-notification": "hide-system-media-controls",
    "show-track-slider": "show-popup-progress-bar",
    "show-popup-cover-art": "show-popup-album-art",
    "show-label": "show-top-bar-track-information",
    "show-player-icon": "show-top-bar-app-icon",
    "show-control-icons": "show-top-bar-playback-controls",
    "show-control-icons-play": "show-top-bar-play-pause",
    "show-control-icons-next": "show-top-bar-next-track",
    "show-control-icons-previous": "show-top-bar-previous-track",
    "colored-player-icon": "use-colored-top-bar-app-icon",
    "colored-player-icon-menu": "use-colored-popup-app-icon",
    "cover-art-radius": "popup-album-art-corner-radius",
    "elements-order": "top-bar-element-order",
    "labels-order": "top-bar-track-information-content",
    "cache-art": "cache-album-art",
    "blacklisted-players": "blocked-apps",
    "mediacontrols-show-popup-menu": "toggle-popup-shortcut",
});

export const NAMING_SETTING_KEY_MIGRATIONS = Object.freeze({
    "top-bar-track-information-lock-width": "lock-top-bar-track-information-width",
    "top-bar-colored-app-icon": "use-colored-top-bar-app-icon",
    "popup-colored-app-icon": "use-colored-popup-app-icon",
    "top-bar-elements-order": "top-bar-element-order",
});

export const PLACEMENT_SETTING_KEY_MIGRATIONS = Object.freeze({
    "extension-position": "top-bar-position",
    "extension-index": "top-bar-index",
});

export const SHORTCUT_SETTING_KEY_MIGRATIONS = Object.freeze({
    "toggle-popup-shortcut": "shortcut-show-popup",
});

export const INPUT_SETTING_KEY_MIGRATIONS = Object.freeze({
    "shortcut-show-popup": "shortcut-toggle-popup",
});

const LEGACY_ELEMENT_NAMES = Object.freeze({
    ICON: "APP_ICON",
    LABEL: "TRACK_INFORMATION",
    CONTROLS: "PLAYBACK_CONTROLS",
});

const INPUT_ACTION_KEYS = Object.freeze([
    "mouse-action-left",
    "mouse-action-middle",
    "mouse-action-right",
    "mouse-action-double",
    "mouse-action-scroll-up",
    "mouse-action-scroll-down",
]);

const LEGACY_PLAYER_INPUT_ACTIONS = Object.freeze({
    17: 9, // RAISE_PLAYER -> RAISE_APP
    16: 10, // QUIT_PLAYER -> QUIT_APP
});

const RETIRED_INPUT_ACTIONS = Object.freeze({
    ...LEGACY_PLAYER_INPUT_ACTIONS,
    13: 1, // PLAY -> PLAY_PAUSE
    14: 1, // PAUSE -> PLAY_PAUSE
    15: 8, // SHOW_POPUP -> TOGGLE_POPUP
});

/**
 * Returns whether a key already has a user value.
 *
 * Migrations copy legacy values only when the destination key is still untouched,
 * preserving explicit user choices made after an upgrade.
 *
 * @param {Gio.Settings} settings - Extension settings object.
 * @param {string} key - GSettings key name.
 * @returns {boolean} True when a user value exists.
 */
function hasUserValue(settings, key) {
    return settings.get_user_value(key) !== null;
}

/**
 * Copies one legacy setting into its current key when safe.
 *
 * The helper preserves destination values that were already set by the user. The
 * legacy element-order key is translated from historical names to current top-bar
 * element IDs while being copied.
 *
 * @param {Gio.Settings} settings - Extension settings object.
 * @param {string} sourceKey - Legacy key to read.
 * @param {string} destinationKey - Current key to write.
 */
function copyUserSetting(settings, sourceKey, destinationKey) {
    if (!hasUserValue(settings, sourceKey) || hasUserValue(settings, destinationKey)) return;

    if (sourceKey === "elements-order") {
        const elements = settings.get_strv(sourceKey).map((element) => LEGACY_ELEMENT_NAMES[element] ?? element);
        settings.set_strv(destinationKey, elements);
        return;
    }

    settings.set_value(destinationKey, settings.get_value(sourceKey));
}

/**
 * Applies a map of legacy key names to current key names.
 *
 * @param {Gio.Settings} settings - Extension settings object.
 * @param {Record<string, string>} migrations - Source-to-destination key map.
 */
function migrateSettingKeys(settings, migrations) {
    for (const [sourceKey, destinationKey] of Object.entries(migrations)) {
        copyUserSetting(settings, sourceKey, destinationKey);
    }
}

/**
 * Inserts the visualizer into existing top-bar element order settings.
 *
 * Older installations did not know about the visualizer element. The migration
 * places it before playback controls when possible so existing layouts keep their
 * general identity/control ordering.
 *
 * @param {Gio.Settings} settings - Extension settings object.
 */
function migrateTopBarVisualizerOrder(settings) {
    const key = "top-bar-element-order";
    const elementOrder = settings.get_strv(key);
    if (elementOrder.includes("VISUALIZER")) return;

    const nextElementOrder = [...elementOrder];
    const playbackControlsIndex = nextElementOrder.indexOf("PLAYBACK_CONTROLS");
    nextElementOrder.splice(
        playbackControlsIndex >= 0 ? playbackControlsIndex : nextElementOrder.length,
        0,
        "VISUALIZER",
    );
    settings.set_strv(key, nextElementOrder);
}

/**
 * Rewrites historical input-action enum values to their current actions.
 *
 * @param {Gio.Settings} settings - Extension settings object.
 * @param {Record<number, number>} migrations - Old-to-new enum value map.
 */
function migrateInputActions(settings, migrations) {
    for (const key of INPUT_ACTION_KEYS) {
        const currentValue = settings.get_enum(key);
        const migratedValue = migrations[currentValue];
        if (migratedValue !== undefined) settings.set_enum(key, migratedValue);
    }
}

/**
 * Runs all pending settings migrations exactly once.
 *
 * The schema-version key records the last completed migration boundary. Each
 * branch is intentionally cumulative so users can upgrade from any historical
 * version directly to the current schema.
 *
 * @param {Gio.Settings} settings - Extension settings object.
 * @returns {boolean} True when at least one migration was applied.
 */
export function migrateSettings(settings) {
    const version = settings.get_uint(SETTINGS_SCHEMA_VERSION_KEY);
    if (version >= SETTINGS_SCHEMA_VERSION) return false;

    if (version < 1) migrateSettingKeys(settings, LEGACY_SETTING_KEY_MIGRATIONS);
    if (version < 2) migrateInputActions(settings, LEGACY_PLAYER_INPUT_ACTIONS);
    if (version < 3) migrateSettingKeys(settings, NAMING_SETTING_KEY_MIGRATIONS);
    if (version < 4) migrateSettingKeys(settings, PLACEMENT_SETTING_KEY_MIGRATIONS);
    if (version < 5) migrateSettingKeys(settings, SHORTCUT_SETTING_KEY_MIGRATIONS);
    if (version < 6) {
        migrateSettingKeys(settings, INPUT_SETTING_KEY_MIGRATIONS);
        migrateInputActions(settings, RETIRED_INPUT_ACTIONS);
    }
    if (version < 7) migrateTopBarVisualizerOrder(settings);
    // Version 8 adds top-bar-visualizer-speed with a schema default of 4.
    // Version 9 adds the popup track-information master switch with a default of true.

    settings.set_uint(SETTINGS_SCHEMA_VERSION_KEY, SETTINGS_SCHEMA_VERSION);
    return true;
}
