/**
 * @file version.js
 * @module shared.utils.version
 *
 * Provides toolkit-independent version comparisons for platform guards.
 *
 * Preferences and tests use the same comparison without importing GTK or
 * Libadwaita runtime objects.
 */

import { MINIMUM_LIBADWAITA_VERSION } from "../constants/platform.js";

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
