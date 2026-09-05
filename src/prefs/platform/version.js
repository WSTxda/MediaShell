/**
 * @file version.js
 * @module prefs.platform.version
 *
 * Owns the Preferences-process Libadwaita version requirement and comparison.
 *
 * Keeping this guard under prefs makes the process-specific platform dependency
 * explicit while the comparison itself remains deterministic and GI-free.
 */

/** Minimum Libadwaita version required by MediaShell preferences. */
export const MINIMUM_LIBADWAITA_VERSION = Object.freeze({
  major: 1,
  minor: 7,
});

/**
 * Returns whether a major/minor version satisfies the declared minimum.
 *
 * @param {number} major - Runtime major version.
 * @param {number} minor - Runtime minor version.
 * @param {{major: number, minor: number}} minimum - Required version boundary.
 * @returns {boolean} True when the runtime version is at least the boundary.
 */
export function isVersionAtLeast(
  major,
  minor,
  minimum = MINIMUM_LIBADWAITA_VERSION,
) {
  return (
    major > minimum.major || (major === minimum.major && minor >= minimum.minor)
  );
}
