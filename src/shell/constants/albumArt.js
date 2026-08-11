/**
 * @file albumArt.js
 * @module shell.constants.albumArt
 *
 * Defines Shell-owned album-art presentation and bounded I/O constants.
 *
 * Renderers share presentation values while AlbumArtLoader applies cache,
 * payload, and request limits to untrusted media metadata.
 */

/** Width of the theme-aware frame separating artwork from surrounding UI. */
export const ALBUM_ART_OUTLINE_WIDTH = 1;

/** Decode/render scale retained before St.Icon maps the image to actor size. */
export const ALBUM_ART_RENDER_SCALE = 2;

/** Maximum total size of persistent album-art cache files; currently 128 MiB. */
export const ALBUM_ART_CACHE_MAX_BYTES = 128 * 1024 * 1024;

/** Maximum accepted album-art file or response size; currently 16 MiB. */
export const ALBUM_ART_MAX_BYTES = 16 * 1024 * 1024;

/** Chunk size used while streaming a remote album-art response. */
export const ALBUM_ART_READ_CHUNK_BYTES = 64 * 1024;

/** HTTP timeout for remote album-art requests, in seconds. */
export const ALBUM_ART_REQUEST_TIMEOUT_SECONDS = 15;
