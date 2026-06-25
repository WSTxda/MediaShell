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

// --- Supported platform baseline ---

/** GNOME Shell major versions supported by MediaShell */
export const SUPPORTED_GNOME_SHELL_VERSIONS = Object.freeze(["47", "48", "49", "50"]);

/** Minimum Libadwaita version required by preferences widgets */
export const MINIMUM_LIBADWAITA_VERSION = Object.freeze({
    major: 1,
    minor: 6,
});

// --- Version helpers ---

/** Returns whether a major/minor version is at least the declared minimum */
export function isVersionAtLeast(major, minor, minimum = MINIMUM_LIBADWAITA_VERSION) {
    return major > minimum.major || (major === minimum.major && minor >= minimum.minor);
}
