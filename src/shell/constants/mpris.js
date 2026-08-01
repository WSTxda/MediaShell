/**
 * @file mpris.js
 * @module shell.constants.mpris
 *
 * Defines Shell-side MPRIS initialization and D-Bus call timeouts.
 *
 * Proxy owners use these bounds to avoid blocking GNOME Shell indefinitely when
 * a third-party media endpoint is slow, incomplete, or disappears mid-request.
 */

/** Maximum time to wait for MPRIS proxies during initialization. */
export const MPRIS_INIT_TIMEOUT_MS = 5000;

/** Polling interval while waiting for MPRIS proxies to become ready. */
export const MPRIS_INIT_POLL_INTERVAL_MS = 750;

/** Timeout for individual MPRIS D-Bus method/property calls. */
export const DBUS_CALL_TIMEOUT_MS = 1000;

/** Timeout for the initial D-Bus ListNames discovery call. */
export const DBUS_LIST_NAMES_TIMEOUT_MS = 2000;
