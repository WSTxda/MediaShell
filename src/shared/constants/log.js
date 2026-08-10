/**
 * @file log.js
 * @module shared.constants.log
 *
 * Defines bounded logging policy shared by Shell and Preferences.
 *
 * The cache limit keeps one-shot diagnostics useful without allowing malformed
 * remote state or repeated UI failures to grow process memory indefinitely.
 */

/** Maximum number of distinct log-once keys retained per logger level. */
export const LOG_ONCE_CACHE_LIMIT = 256;
