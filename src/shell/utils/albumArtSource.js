/**
 * @file albumArtSource.js
 * @module shell.utils.albumArtSource
 *
 * Resolves a media app's preferred album art and its local-track fallback.
 * Keeping this source selection shared makes every artwork surface show the
 * same result for a given MPRIS metadata snapshot.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { createLogger } from "../../shared/utils/log.js";
import { isCancellationError } from "./errors.js";

const logger = createLogger("albumArtSource");

Gio._promisify(Gio.File.prototype, "query_info_async", "query_info_finish");

/**
 * Loads MPRIS artwork, then falls back to a local track thumbnail when one is
 * available. The returned fallback icon represents the local track when no
 * image can be loaded.
 */
export async function resolveAlbumArtSource({
  albumArtLoader,
  albumArtUri,
  trackUri,
  busName,
  cacheEnabled,
  loadCancellable,
}) {
  let fallbackIcon = null;
  let albumArtSource = await tryLoadAlbumArt(
    albumArtLoader,
    albumArtUri,
    cacheEnabled,
    loadCancellable,
    "MPRIS album art",
    busName,
  );
  if (albumArtSource || !trackUri) return { albumArtSource, fallbackIcon };

  let parsedTrackUri;
  try {
    parsedTrackUri = GLib.Uri.parse(trackUri, GLib.UriFlags.NONE);
  } catch (error) {
    logger.debugOnce(
      `track-uri:${busName}`,
      "Ignoring an invalid local track URI",
      error,
    );
    return { albumArtSource: null, fallbackIcon };
  }
  if (parsedTrackUri.get_scheme() !== "file")
    return { albumArtSource: null, fallbackIcon };

  const trackFile = Gio.File.new_for_uri(parsedTrackUri.to_string());
  let info;
  try {
    info = await trackFile.query_info_async(
      `${Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH},${Gio.FILE_ATTRIBUTE_STANDARD_ICON}`,
      Gio.FileQueryInfoFlags.NONE,
      GLib.PRIORITY_DEFAULT,
      loadCancellable,
    );
  } catch (error) {
    if (isCancellationError(error)) throw error;
    logger.debugOnce(
      `track-metadata:${busName}`,
      "Local track metadata did not provide album art",
      error,
    );
    return { albumArtSource: null, fallbackIcon };
  }

  fallbackIcon = info.get_icon();
  const thumbnailPath = info.get_attribute_byte_string(
    Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH,
  );
  if (thumbnailPath)
    albumArtSource = await tryLoadAlbumArt(
      albumArtLoader,
      Gio.File.new_for_path(thumbnailPath).get_uri(),
      cacheEnabled,
      loadCancellable,
      "thumbnail",
      busName,
    );

  return { albumArtSource, fallbackIcon };
}

async function tryLoadAlbumArt(
  albumArtLoader,
  albumArtUri,
  cacheEnabled,
  loadCancellable,
  sourceName,
  busName,
) {
  if (!albumArtUri) return null;
  try {
    return await albumArtLoader.loadAlbumArt(
      albumArtUri,
      cacheEnabled,
      loadCancellable,
    );
  } catch (error) {
    if (isCancellationError(error)) throw error;
    logger.debugOnce(
      `source-load:${busName}:${sourceName}`,
      `Failed to load ${sourceName}; trying the next fallback`,
      error,
    );
    return null;
  }
}
