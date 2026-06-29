/**
 * @file AlbumArtLoader.js
 * @module shell.services.AlbumArtLoader
 *
 * Loads local or remote album art without blocking popup rendering.
 *
 * The singleton owns the Soup.Session, cache-write cancellable, and album-art
 * cache directory readiness state. PopupAlbumArt requests streams from this
 * service while keeping decoding and actor rendering local to the popup widget.
 * ExtensionController shuts the service down on disable to abort network work
 * and cancel pending cache writes.
 *
 * @see src/shell/ui/popup/PopupAlbumArt.js
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup";

import {
  ALBUM_ART_MAX_BYTES,
  ALBUM_ART_READ_CHUNK_BYTES,
  ALBUM_ART_REQUEST_TIMEOUT_SECONDS,
} from "../../shared/constants/limits.js";
import { ALBUM_ART_CACHE_DIRECTORY_NAME } from "../../shared/constants/settings.js";
import { createLogger } from "../../shared/utils/log.js";
import { isCancellationError } from "../utils/errors.js";

Gio._promisify(Gio.File.prototype, "read_async", "read_finish");
Gio._promisify(Gio.File.prototype, "delete_async", "delete_finish");
Gio._promisify(
  Gio.File.prototype,
  "replace_contents_bytes_async",
  "replace_contents_finish",
);
Gio._promisify(Soup.Session.prototype, "send_async", "send_finish");
Gio._promisify(
  Gio.InputStream.prototype,
  "read_bytes_async",
  "read_bytes_finish",
);
Gio._promisify(Gio.InputStream.prototype, "close_async", "close_finish");

const logger = createLogger("AlbumArtLoader");
const albumArtCacheDirectoryPath = GLib.build_filenamev([
  GLib.get_user_cache_dir(),
  ALBUM_ART_CACHE_DIRECTORY_NAME,
]);

function createAlbumArtCacheKey(albumArtUri) {
  return GLib.compute_checksum_for_string(
    GLib.ChecksumType.SHA256,
    albumArtUri,
    -1,
  );
}

function createAlbumArtCacheFile(albumArtUri) {
  return Gio.File.new_for_path(
    GLib.build_filenamev([
      albumArtCacheDirectoryPath,
      createAlbumArtCacheKey(albumArtUri),
    ]),
  );
}

function concatenateByteChunks(chunks, totalBytes) {
  const data = new Uint8Array(totalBytes);
  let offset = 0;
  for (const bytes of chunks) {
    const chunk = bytes.get_data();
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return GLib.Bytes.new(data);
}

function parseAlbumArtUri(albumArtUri) {
  try {
    return GLib.Uri.parse(albumArtUri, GLib.UriFlags.NONE);
  } catch (error) {
    logger.debugOnce(
      `invalid-uri:${albumArtUri}`,
      "Ignoring an invalid album-art URI",
      error,
    );
    return null;
  }
}

/**
 * Loads local or remote album art without blocking popup rendering.
 */
export default class AlbumArtLoader {
  static #instance = null;

  static getInstance() {
    AlbumArtLoader.#instance ??= new AlbumArtLoader();
    return AlbumArtLoader.#instance;
  }

  #cacheDirectoryReady = null;
  #cacheWriteCancellable = null;
  #session = null;

  #getSession() {
    this.#session ??= new Soup.Session({
      timeout: ALBUM_ART_REQUEST_TIMEOUT_SECONDS,
    });
    return this.#session;
  }

  #getCacheWriteCancellable() {
    if (
      !this.#cacheWriteCancellable ||
      this.#cacheWriteCancellable.is_cancelled()
    )
      this.#cacheWriteCancellable = new Gio.Cancellable();
    return this.#cacheWriteCancellable;
  }

  #ensureAlbumArtCacheDirectory() {
    if (this.#cacheDirectoryReady === true) return true;

    const directoryReady =
      GLib.mkdir_with_parents(albumArtCacheDirectoryPath, 0o755) !== -1;
    if (directoryReady) this.#cacheDirectoryReady = true;
    else
      logger.warnOnce(
        "cache-directory",
        "Album-art cache directory could not be created",
      );
    return directoryReady;
  }

  #getAlbumArtCacheFile(albumArtUri) {
    return this.#ensureAlbumArtCacheDirectory()
      ? createAlbumArtCacheFile(albumArtUri)
      : null;
  }

  async #openAlbumArtInputStream(albumArtFile, loadCancellable) {
    if (!albumArtFile) return null;
    return albumArtFile.read_async(GLib.PRIORITY_DEFAULT, loadCancellable);
  }

  async #openCachedAlbumArtInputStream(cacheFile, loadCancellable, cacheKey) {
    try {
      return await this.#openAlbumArtInputStream(cacheFile, loadCancellable);
    } catch (error) {
      if (isCancellationError(error)) throw error;
      if (cacheKey) logger.debug("Album art cache miss for", cacheKey);
      return null;
    }
  }

  #writeAlbumArtCacheBytes(cacheFile, responseBytes, cacheKey) {
    if (!cacheFile) return;

    // Cache persistence must not delay the first popup paint.
    cacheFile
      .replace_contents_bytes_async(
        responseBytes,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        this.#getCacheWriteCancellable(),
      )
      .then(() => logger.debug("Album art cached for", cacheKey))
      .catch((error) => {
        if (!isCancellationError(error))
          logger.warn("Failed to persist album art in the cache", error);
      });
  }

  async #closeInputStreamAsync(stream) {
    if (!stream) return;

    try {
      await stream.close_async(GLib.PRIORITY_DEFAULT, null);
    } catch (error) {
      if (!isCancellationError(error))
        logger.debugOnce(
          "network-stream-close",
          "Album-art network stream could not be closed",
          error,
        );
    }
  }

  async #readRemoteAlbumArtBytes(httpMessage, loadCancellable) {
    let responseStream = null;
    try {
      logger.debug("Fetching remote album art");
      responseStream = await this.#getSession().send_async(
        httpMessage,
        GLib.PRIORITY_DEFAULT,
        loadCancellable,
      );
      const httpStatus = httpMessage.get_status();
      if (httpStatus < 200 || httpStatus >= 300) {
        logger.debugOnce(
          `http-status:${httpStatus}`,
          "Album-art request returned HTTP status",
          httpStatus,
        );
        return null;
      }

      const declaredLength =
        httpMessage.get_response_headers()?.get_content_length?.() ?? -1;
      if (declaredLength > ALBUM_ART_MAX_BYTES) {
        logger.warnOnce(
          "unsafe-content-length",
          "Rejected album art with an unsafe declared size",
          declaredLength,
        );
        return null;
      }

      const chunks = [];
      let totalBytes = 0;
      while (true) {
        const remainingBytes = ALBUM_ART_MAX_BYTES + 1 - totalBytes;
        const responseBytes = await responseStream.read_bytes_async(
          Math.min(ALBUM_ART_READ_CHUNK_BYTES, remainingBytes),
          GLib.PRIORITY_DEFAULT,
          loadCancellable,
        );
        const chunkSize = responseBytes.get_size();
        if (chunkSize === 0) break;

        totalBytes += chunkSize;
        if (totalBytes > ALBUM_ART_MAX_BYTES) {
          logger.warnOnce(
            "unsafe-payload-size",
            "Rejected album art with an unsafe payload size",
            totalBytes,
          );
          return null;
        }
        // Retain each GBytes object until concatenation so the typed-array
        // view cannot outlive its native backing storage.
        chunks.push(responseBytes);
      }

      return totalBytes > 0 ? concatenateByteChunks(chunks, totalBytes) : null;
    } finally {
      await this.#closeInputStreamAsync(responseStream);
    }
  }

  async loadAlbumArt(
    albumArtUri,
    isCacheEnabled,
    loadCancellable,
    { bypassCacheRead = false } = {},
  ) {
    if (!albumArtUri) return null;
    logger.debug("Loading album art", albumArtUri);

    const uri = parseAlbumArtUri(albumArtUri);
    if (!uri) return null;

    const scheme = uri.get_scheme();
    logger.debug("Fetching album art for", albumArtUri.slice(0, 60));
    if (scheme === "file") {
      const stream = await this.#openAlbumArtInputStream(
        Gio.File.new_for_uri(uri.to_string()),
        loadCancellable,
      );
      if (stream) logger.debug("Album art loaded from local file");
      return stream ? { stream, albumArtUri, loadedFromCache: false } : null;
    }
    if (scheme !== "http" && scheme !== "https") {
      logger.debugOnce(
        `unsupported-scheme:${scheme || "none"}`,
        "Ignoring unsupported album-art URI scheme",
        scheme || "none",
      );
      return null;
    }

    const cacheKey = isCacheEnabled
      ? createAlbumArtCacheKey(albumArtUri)
      : null;
    const cacheFile = isCacheEnabled
      ? this.#getAlbumArtCacheFile(albumArtUri)
      : null;
    const cachedStream = bypassCacheRead
      ? null
      : await this.#openCachedAlbumArtInputStream(
          cacheFile,
          loadCancellable,
          cacheKey,
        );
    if (cachedStream) {
      logger.debug("Album art cache hit for", cacheKey);
      return { stream: cachedStream, albumArtUri, loadedFromCache: true };
    }

    const httpMessage = new Soup.Message({ method: "GET", uri });
    const responseBytes = await this.#readRemoteAlbumArtBytes(
      httpMessage,
      loadCancellable,
    );
    if (!responseBytes) return null;

    this.#writeAlbumArtCacheBytes(cacheFile, responseBytes, cacheKey);
    logger.debug("Album art load completed");
    return {
      stream: Gio.MemoryInputStream.new_from_bytes(responseBytes),
      albumArtUri,
      loadedFromCache: false,
    };
  }

  async removeCachedAlbumArt(albumArtUri, cancellable = null) {
    if (!albumArtUri) return;

    const cacheFile = createAlbumArtCacheFile(albumArtUri);
    try {
      await cacheFile.delete_async(GLib.PRIORITY_DEFAULT, cancellable);
    } catch (error) {
      if (!error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
        logger.debugOnce(
          "cache-delete",
          "Failed to remove an invalid album-art cache entry",
          error,
        );
    }
  }

  destroy() {
    this.#session?.abort();
    this.#session = null;
    this.#cacheWriteCancellable?.cancel();
    this.#cacheWriteCancellable = null;
    this.#cacheDirectoryReady = null;
  }
}
