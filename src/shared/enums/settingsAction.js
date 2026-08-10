/**
 * @file settingsAction.js
 * @module shared.enums.settingsAction
 *
 * Enum values describing how a settings change affects runtime components.
 *
 * SETTINGS_SPEC assigns these actions to individual GSettings keys, and
 * ExtensionController uses them to decide whether to rebuild UI, patch GNOME Shell
 * media controls, refresh blocked apps, or update shortcuts.
 */

export const SettingsAction = Object.freeze({
  REBUILD_INDICATOR: "rebuild-indicator",
  UPDATE_BLOCKED_APPS: "update-blocked-apps",
  UPDATE_GNOME_SHELL_MEDIA_CONTROLS: "update-gnome-shell-media-controls",
});
