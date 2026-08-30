/**
 * @file reducedMotion.js
 * @module shell.utils.reducedMotion
 *
 * Detects and observes the user's reduced-motion accessibility preference.
 *
 * St.ReducedMotion was introduced in GNOME Shell 51. On earlier supported
 * releases the property does not exist, so detection fails open: continuous
 * animations behave exactly as they did before this preference existed.
 */

import St from "gi://St";

/** Whether this Shell release exposes the St.ReducedMotion setting. */
function supportsReducedMotionSetting() {
  return typeof St.ReducedMotion !== "undefined";
}

/** Checks if the user currently prefers reduced motion. */
export function prefersReducedMotion() {
  if (!supportsReducedMotionSetting()) return false;
  return St.Settings.get().reducedMotion === St.ReducedMotion.REDUCE;
}

/**
 * Invokes callback(prefersReducedMotion()) whenever the preference changes.
 *
 * Returns the signal id for disconnectReducedMotionChanged(), or null on
 * Shell releases without St.ReducedMotion, where there is nothing to observe.
 */
export function connectReducedMotionChanged(callback) {
  if (!supportsReducedMotionSetting()) return null;
  return St.Settings.get().connect("notify::reduced-motion", () =>
    callback(prefersReducedMotion()),
  );
}

/** Disconnects a subscription created by connectReducedMotionChanged(). */
export function disconnectReducedMotionChanged(signalId) {
  if (signalId === null || signalId === undefined) return;
  St.Settings.get().disconnect(signalId);
}
