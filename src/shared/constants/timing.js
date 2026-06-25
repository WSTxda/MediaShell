/**
 * @file timing.js
 * @module shared.constants.timing
 *
 * Defines shared timing constants for retries, polling intervals, and grace periods.
 *
 * These values coordinate asynchronous Shell-side behavior that must remain
 * consistent across MPRIS initialization, media-app disappearance handling, and
 * delayed app identity resolution. Keep timing values here when they describe a
 * domain policy that multiple modules may need to understand or tune together.
 */

// --- App identity resolution ---

/** How long to wait before retrying app identity resolution after a bus appears */
export const APP_RESOLUTION_RETRY_DELAY_MS = 750;

/** Maximum number of app resolution retry attempts before giving up */
export const APP_RESOLUTION_RETRY_MAX_ATTEMPTS = 4;

// --- MPRIS initialization ---

/** Maximum ms to wait for MPRIS proxies to become ready during initialization */
export const MPRIS_INIT_TIMEOUT_MS = 5000;

/** Interval between MPRIS initialization readiness polls */
export const MPRIS_INIT_POLL_INTERVAL_MS = 750;

/** Timeout in milliseconds for individual D-Bus method calls on MPRIS proxies */
export const DBUS_CALL_TIMEOUT_MS = 1000;

// --- Media app lifecycle grace periods ---

/** Grace period before marking a media app invalid after its track becomes empty while stopped */
export const MEDIA_APP_EMPTY_STOPPED_GRACE_MS = 5000;

/** Grace period before removing an MPRIS endpoint after its bus name disappears */
export const MEDIA_APP_DISAPPEARANCE_GRACE_MS = 5000;
