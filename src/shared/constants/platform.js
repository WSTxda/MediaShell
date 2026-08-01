/**
 * @file platform.js
 * @module shared.constants.platform
 *
 * Defines the supported GNOME platform baseline values.
 *
 * Runtime guards, metadata validation, and preferences startup depend on these
 * values staying aligned. Version comparison behavior lives in shared utils.
 */

/** GNOME Shell major versions declared as supported by MediaShell. */
export const SUPPORTED_GNOME_SHELL_VERSIONS = Object.freeze([
  "47",
  "48",
  "49",
  "50",
]);

/** Minimum Libadwaita version required by preferences widgets. */
export const MINIMUM_LIBADWAITA_VERSION = Object.freeze({
  major: 1,
  minor: 6,
});
