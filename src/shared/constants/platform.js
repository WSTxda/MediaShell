/**
 * @file platform.js
 * @module shared.constants.platform
 *
 * Defines the supported GNOME platform baseline and version helpers.
 *
 * Runtime guards, metadata validation, and preferences startup all depend on
 * these values staying aligned. Update this file only when the project changes
 * its supported GNOME Shell or Libadwaita baseline everywhere else.
 */

/** GNOME Shell major versions declared as supported by MediaShell. */
export const SUPPORTED_GNOME_SHELL_VERSIONS = Object.freeze(["47", "48", "49", "50"]);

/** Minimum Libadwaita version required by preferences widgets. */
export const MINIMUM_LIBADWAITA_VERSION = Object.freeze({
    major: 1,
    minor: 6,
});

/**
 * Returns whether a major/minor version satisfies the declared minimum.
 *
 * Preferences use this helper before building GTK widgets that require the
 * project baseline. Tests also use it to keep package metadata and runtime guards
 * aligned without importing Libadwaita.
 *
 * @param {number} major - Runtime major version.
 * @param {number} minor - Runtime minor version.
 * @param {{major: number, minor: number}} minimum - Required version boundary.
 * @returns {boolean} True when the runtime version is at least the boundary.
 */
export function isVersionAtLeast(major, minor, minimum = MINIMUM_LIBADWAITA_VERSION) {
    return major > minimum.major || (major === minimum.major && minor >= minimum.minor);
}
