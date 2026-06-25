/**
 * @file limits.js
 * @module shared.constants.limits
 *
 * Defines shared capacity, size, and request-limit constants.
 *
 * These values bound caches, streamed data, and remote requests so resource use
 * stays predictable in both the Shell process and development tooling. Keep
 * tunable limits here when changing one value should be visible to every module
 * that participates in the same memory or I/O policy.
 */

// --- Cache capacities ---

/** Maximum number of distinct log-once keys retained before oldest is evicted (LRU) */
export const LOG_ONCE_CACHE_LIMIT = 256;

/** Maximum number of resolved app identity entries in the Shell resolver LRU cache */
export const APP_RESOLVER_CACHE_LIMIT = 128;

// --- Album art I/O limits ---

/** Maximum accepted album art file/stream size in bytes (16 MB) */
export const ALBUM_ART_MAX_BYTES = 16 * 1024 * 1024;

/** Read chunk size for streaming album art data */
export const ALBUM_ART_READ_CHUNK_BYTES = 64 * 1024;

/** HTTP request timeout for remote album art fetches, in seconds */
export const ALBUM_ART_REQUEST_TIMEOUT_SECONDS = 15;
