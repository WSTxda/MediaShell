/**
 * @file positionConstants.js
 * @module shell.mpris.positionConstants
 *
 * Defines pure timing thresholds for local MPRIS position projection.
 *
 * The projection helper and its tests share these values without depending on
 * GNOME Shell, Gio, or a live D-Bus connection.
 */

/** Maximum age of a projected position before an exact refresh is requested. */
export const POSITION_ESTIMATE_MAX_AGE_MICROSECONDS = 30 * 1000 * 1000;

/** Maximum tolerated monotonic/wall-clock divergence before re-anchoring. */
export const POSITION_CLOCK_DRIFT_TOLERANCE_MICROSECONDS = 2 * 1000 * 1000;
