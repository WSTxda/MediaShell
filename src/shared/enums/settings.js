/**
 * @file settings.js
 * @module shared.enums.settings
 *
 * Enum values describing how a settings change affects runtime components.
 *
 * SettingsSpec assigns these actions to individual GSettings keys, and
 * ExtensionController uses them to decide whether to rebuild UI, patch system
 * media controls, refresh blocked apps, or update shortcuts.
 */

export const SettingsAction = Object.freeze({
    REBUILD_TOP_BAR_BUTTON: "rebuild-top-bar-button",
    UPDATE_BLOCKED_APPS: "update-blocked-apps",
    UPDATE_SYSTEM_MEDIA_CONTROLS: "update-system-media-controls",
});
