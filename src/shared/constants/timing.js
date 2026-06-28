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

/** Delay before retrying app identity resolution after a new MPRIS bus appears. */
export const APP_RESOLUTION_RETRY_DELAY_MS = 750;

/** Maximum number of app resolution retry attempts before giving up on a media app. */
export const APP_RESOLUTION_RETRY_MAX_ATTEMPTS = 4;

// --- MPRIS initialization ---

/** Maximum time to wait for MPRIS proxies to become ready during initialization. */
export const MPRIS_INIT_TIMEOUT_MS = 5000;

/** Polling interval used while waiting for MPRIS proxies to become ready. */
export const MPRIS_INIT_POLL_INTERVAL_MS = 750;

/** Timeout for individual D-Bus method calls on MPRIS proxies. */
export const DBUS_CALL_TIMEOUT_MS = 1000;

/** Timeout for the initial D-Bus ListNames discovery call. */
export const DBUS_LIST_NAMES_TIMEOUT_MS = 2000;

// --- Media app lifecycle grace periods ---

/**
 * Grace period before marking a stopped media app invalid after its track becomes empty.
 *
 * Browser-backed sessions can briefly clear metadata while replacing one media
 * endpoint with the next. This delay prevents top bar flicker without retaining
 * stale controls forever.
 */
export const MEDIA_APP_EMPTY_STOPPED_GRACE_MS = 5000;

/**
 * Grace period before removing an MPRIS endpoint after its bus owner disappears.
 *
 * The registry keeps the proxy as an internal hand-off candidate during this
 * window, but ownerless apps are not allowed to remain visible if no replacement
 * takes over.
 */
export const MEDIA_APP_DISAPPEARANCE_GRACE_MS = 5000;
