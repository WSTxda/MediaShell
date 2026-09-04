/**
 * @file albumArtLoading.js
 * @module shell.utils.albumArtLoading
 *
 * Shares source resolution, asynchronous decoding, and corrupt-cache recovery
 * between popup and top-bar renderers. Surface owners retain request currency,
 * cancellation, presentation, and teardown.
 */

import GdkPixbuf from "gi://GdkPixbuf";
import Gio from "gi://Gio";

import { createLogger } from "../../shared/logging/logger.js";
import { ALBUM_ART_RENDER_SCALE } from "../constants/albumArt.js";
import { resolveAlbumArtSource } from "./albumArtSource.js";
import { isCancellationError } from "./errors.js";

const logger = createLogger("albumArtLoading");

Gio._promisify(
  GdkPixbuf.Pixbuf,
  "new_from_stream_at_scale_async",
  "new_from_stream_finish",
);

function closeInputStream(stream) {
  try {
    stream?.close(null);
  } catch {
    // Cancellation and GdkPixbuf may close the stream before teardown.
  }
}

async function decodeAlbumArtStream(stream, size, loadCancellable) {
  if (!stream) return null;
  try {
    const decodeSize = Math.max(1, Math.round(size * ALBUM_ART_RENDER_SCALE));
    return await GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
      stream,
      decodeSize,
      decodeSize,
      true,
      loadCancellable,
    );
  } finally {
    closeInputStream(stream);
  }
}

/** Decodes artwork and retries once from the source when a cache entry is corrupt. */
async function decodeAlbumArtSource({
  albumArtLoader,
  albumArtSource,
  size,
  loadCancellable,
}) {
  if (!albumArtSource) return null;

  try {
    return await decodeAlbumArtStream(
      albumArtSource.stream,
      size,
      loadCancellable,
    );
  } catch (error) {
    if (isCancellationError(error) || !albumArtSource.loadedFromCache)
      throw error;

    logger.debugOnce(
      `invalid-cache:${albumArtSource.albumArtUri}`,
      "Discarding an invalid album-art cache entry",
      albumArtSource.albumArtUri,
      error,
    );
    await albumArtLoader.removeCachedAlbumArt(
      albumArtSource.albumArtUri,
      loadCancellable,
    );
    const refreshedSource = await albumArtLoader.loadAlbumArt(
      albumArtSource.albumArtUri,
      albumArtSource.cacheEnabled,
      loadCancellable,
      { bypassCacheRead: true },
    );
    return decodeAlbumArtStream(
      refreshedSource?.stream ?? null,
      size,
      loadCancellable,
    );
  }
}

/**
 * Resolves and decodes one immutable request without taking lifecycle ownership.
 *
 * The caller owns the cancellable, stale-result checks, and result commit.
 */
export async function loadAlbumArtResult({
  albumArtLoader,
  request,
  loadCancellable,
}) {
  const { albumArtSource, fallbackIcon } = await resolveAlbumArtSource({
    albumArtLoader,
    ...request,
    loadCancellable,
  });
  const pixbuf = await decodeAlbumArtSource({
    albumArtLoader,
    albumArtSource,
    size: request.width,
    loadCancellable,
  });

  return { pixbuf, fallbackIcon };
}
