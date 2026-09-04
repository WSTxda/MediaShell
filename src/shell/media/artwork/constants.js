/**
 * @file constants.js
 * @module shell.media.artwork.constants
 *
 * Defines bounded artwork I/O limits owned by the Shell media runtime.
 *
 * Artwork metadata is untrusted input supplied by MPRIS endpoints. These limits
 * bound persistent cache growth, individual local/remote payloads, streaming
 * memory, and HTTP lifetime before any image reaches a Shell surface.
 */

/** Maximum total size of persistent artwork cache files; currently 128 MiB. */
export const ARTWORK_CACHE_MAX_BYTES = 128 * 1024 * 1024;

/** Maximum accepted artwork file or response size; currently 16 MiB. */
export const ARTWORK_MAX_BYTES = 16 * 1024 * 1024;

/** Chunk size used while streaming a remote artwork response. */
export const ARTWORK_READ_CHUNK_BYTES = 64 * 1024;

/** HTTP timeout for remote artwork requests, in seconds. */
export const ARTWORK_REQUEST_TIMEOUT_SECONDS = 15;
