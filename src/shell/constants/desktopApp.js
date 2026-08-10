/**
 * @file desktopApp.js
 * @module shell.constants.desktopApp
 *
 * Defines desktop-application resolution cache and retry policy.
 *
 * DesktopAppResolver owns the bounded identity caches. MediaShellIndicator uses
 * the retry policy while GNOME Shell associates a new MPRIS media app with its
 * desktop application.
 */

/** Maximum number of resolved desktop-app identities retained by the resolver. */
export const DESKTOP_APP_RESOLVER_CACHE_LIMIT = 128;

/** TTL for unresolved desktop-app identity cache entries. */
export const DESKTOP_APP_RESOLVER_MISS_CACHE_TTL_MS = 30_000;

/** Delay before retrying desktop-app resolution after a new MPRIS bus appears. */
export const DESKTOP_APP_RESOLUTION_RETRY_DELAY_MS = 750;

/** Maximum desktop-app resolution retries for one active media app. */
export const DESKTOP_APP_RESOLUTION_RETRY_MAX_ATTEMPTS = 4;
