/**
 * @file albumArt.js
 * @module shell.constants.albumArt
 *
 * Defines Shell-owned album-art cache, payload, and request limits.
 *
 * AlbumArtLoader applies these values to local files, remote responses, and its
 * persistent cache so untrusted media metadata cannot cause unbounded I/O.
 */

/** Maximum total size of persistent album-art cache files; currently 128 MiB. */
export const ALBUM_ART_CACHE_MAX_BYTES = 128 * 1024 * 1024;

/** Maximum accepted album-art file or response size; currently 16 MiB. */
export const ALBUM_ART_MAX_BYTES = 16 * 1024 * 1024;

/** Chunk size used while streaming a remote album-art response. */
export const ALBUM_ART_READ_CHUNK_BYTES = 64 * 1024;

/** HTTP timeout for remote album-art requests, in seconds. */
export const ALBUM_ART_REQUEST_TIMEOUT_SECONDS = 15;
