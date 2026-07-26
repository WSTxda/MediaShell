/**
 * @file AlbumArtLoader.js
 * @module shell.services.AlbumArtLoader
 *
 * Loads local or remote album art without blocking popup rendering.
 *
 * The singleton owns the Soup.Session, bounded persistent cache, cache-write
 * cancellable, and album-art cache directory readiness state. PopupAlbumArt
 * requests streams from this service while keeping decoding and actor rendering
 * local to the popup widget. ExtensionController shuts the service down on
 * disable to abort network work and cancel pending cache writes/pruning.
 *
 * @see src/shell/ui/popup/PopupAlbumArt.js
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup";

import {
  ALBUM_ART_CACHE_MAX_BYTES,
  ALBUM_ART_MAX_BYTES,
  ALBUM_ART_READ_CHUNK_BYTES,
  ALBUM_ART_REQUEST_TIMEOUT_SECONDS,
} from "../../shared/constants/limits.js";
import { EXTENSION_UUID } from "../../shared/constants/project.js";
import { selectAlbumArtCacheEvictions } from "../../shared/utils/albumArt.js";
import { createLogger } from "../../shared/utils/log.js";
import { isCancellationError } from "../utils/errors.js";

Gio._promisify(Gio.File.prototype, "read_async", "read_finish");
Gio._promisify(Gio.File.prototype, "delete_async", "delete_finish");
Gio._promisify(Gio.File.prototype, "query_info_async", "query_info_finish");
Gio._promisify(
  Gio.File.prototype,
  "enumerate_children_async",
  "enumerate_children_finish",
);
Gio._promisify(
  Gio.File.prototype,
  "replace_contents_bytes_async",
  "replace_contents_finish",
);
Gio._promisify(
  Gio.FileEnumerator.prototype,
  "next_files_async",
  "next_files_finish",
);
Gio._promisify(Gio.FileEnumerator.prototype, "close_async", "close_finish");
Gio._promisify(Soup.Session.prototype, "send_async", "send_finish");
Gio._promisify(
  Gio.InputStream.prototype,
  "read_bytes_async",
  "read_bytes_finish",
);
Gio._promisify(Gio.InputStream.prototype, "close_async", "close_finish");

const logger = createLogger("AlbumArtLoader");
const ALBUM_ART_FILE_ATTRIBUTES = "standard::type,standard::size";
const ALBUM_ART_CACHE_ATTRIBUTES =
  "standard::name,standard::type,standard::size,time::modified";
const albumArtCacheDirectoryPath = GLib.build_filenamev([
  GLib.get_user_cache_dir(),
  EXTENSION_UUID,
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

function isFileNotFoundError(error) {
  return Boolean(error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND));
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

  static destroyInstance() {
    const instance = AlbumArtLoader.#instance;
    AlbumArtLoader.#instance = null;
    instance?.destroy();
  }

  #cacheDirectoryReady = null;
  #cachePrunePromise = null;
  #cachePruneRequested = false;
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

  async #openBoundedAlbumArtInputStream(
    albumArtFile,
    loadCancellable,
    sourceKey,
  ) {
    if (!albumArtFile) return null;

    const info = await albumArtFile.query_info_async(
      ALBUM_ART_FILE_ATTRIBUTES,
      Gio.FileQueryInfoFlags.NONE,
      GLib.PRIORITY_DEFAULT,
      loadCancellable,
    );
    const fileSize = info.get_size();
    if (
      info.get_file_type() !== Gio.FileType.REGULAR ||
      fileSize <= 0 ||
      fileSize > ALBUM_ART_MAX_BYTES
    ) {
      logger.warnOnce(
        `unsafe-file:${sourceKey}`,
        "Rejected album art with an unsafe local or cached file size",
        fileSize,
      );
      return null;
    }

    return albumArtFile.read_async(GLib.PRIORITY_DEFAULT, loadCancellable);
  }

  async #openCachedAlbumArtInputStream(cacheFile, loadCancellable, cacheKey) {
    try {
      return await this.#openBoundedAlbumArtInputStream(
        cacheFile,
        loadCancellable,
        cacheKey,
      );
    } catch (error) {
      if (isCancellationError(error)) throw error;
      return null;
    }
  }

  #writeAlbumArtCacheBytes(cacheFile, responseBytes, cacheKey) {
    if (!cacheFile) return;

    // Cache persistence and pruning must not delay the first popup paint.
    cacheFile
      .replace_contents_bytes_async(
        responseBytes,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        this.#getCacheWriteCancellable(),
      )
      .then(() => {
        this.#requestAlbumArtCachePrune();
      })
      .catch((error) => {
        if (!isCancellationError(error))
          logger.warnOnce(
            "cache-write",
            "Failed to persist album art in the cache",
            error,
          );
      });
  }

  #requestAlbumArtCachePrune() {
    this.#cachePruneRequested = true;
    if (this.#cachePrunePromise) return;

    const prunePromise = (async () => {
      while (
        this.#cachePruneRequested &&
        !this.#getCacheWriteCancellable().is_cancelled()
      ) {
        this.#cachePruneRequested = false;
        await this.#pruneAlbumArtCacheOnce();
      }
    })()
      .catch((error) => {
        if (!isCancellationError(error) && !isFileNotFoundError(error))
          logger.warnOnce(
            "cache-prune",
            "Album-art cache pruning failed",
            error,
          );
      })
      .finally(() => {
        if (this.#cachePrunePromise === prunePromise)
          this.#cachePrunePromise = null;
        if (this.#cachePruneRequested) this.#requestAlbumArtCachePrune();
      });
    this.#cachePrunePromise = prunePromise;
  }

  async #pruneAlbumArtCacheOnce() {
    if (!this.#ensureAlbumArtCacheDirectory()) return;

    const cancellable = this.#getCacheWriteCancellable();
    const cacheDirectory = Gio.File.new_for_path(albumArtCacheDirectoryPath);
    const enumerator = await cacheDirectory.enumerate_children_async(
      ALBUM_ART_CACHE_ATTRIBUTES,
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      GLib.PRIORITY_DEFAULT,
      cancellable,
    );
    const entries = [];

    try {
      while (true) {
        const infos = await enumerator.next_files_async(
          64,
          GLib.PRIORITY_DEFAULT,
          cancellable,
        );
        if (infos.length === 0) break;

        for (const info of infos) {
          if (info.get_file_type() !== Gio.FileType.REGULAR) continue;
          entries.push({
            name: info.get_name(),
            sizeBytes: info.get_size(),
            modifiedSeconds: info.get_attribute_uint64("time::modified"),
          });
        }
      }
    } finally {
      try {
        await enumerator.close_async(GLib.PRIORITY_DEFAULT, null);
      } catch (error) {
        if (!isCancellationError(error))
          logger.debugOnce(
            "cache-enumerator-close",
            "Album-art cache enumerator could not be closed",
            error,
          );
      }
    }

    const evictions = selectAlbumArtCacheEvictions(
      entries,
      ALBUM_ART_CACHE_MAX_BYTES,
    );
    for (let offset = 0; offset < evictions.length; offset += 32) {
      await Promise.all(
        evictions.slice(offset, offset + 32).map(async (name) => {
          try {
            await cacheDirectory
              .get_child(name)
              .delete_async(GLib.PRIORITY_DEFAULT, cancellable);
          } catch (error) {
            if (!isFileNotFoundError(error)) throw error;
          }
        }),
      );
    }
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
    const uri = parseAlbumArtUri(albumArtUri);
    if (!uri) return null;

    const scheme = uri.get_scheme();
    if (scheme === "file") {
      const stream = await this.#openBoundedAlbumArtInputStream(
        Gio.File.new_for_uri(uri.to_string()),
        loadCancellable,
        createAlbumArtCacheKey(albumArtUri),
      );
      return stream
        ? {
            stream,
            albumArtUri,
            loadedFromCache: false,
            cacheEnabled: Boolean(isCacheEnabled),
          }
        : null;
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
      this.#requestAlbumArtCachePrune();
      return {
        stream: cachedStream,
        albumArtUri,
        loadedFromCache: true,
        cacheEnabled: Boolean(isCacheEnabled),
      };
    }

    const httpMessage = new Soup.Message({ method: "GET", uri });
    const responseBytes = await this.#readRemoteAlbumArtBytes(
      httpMessage,
      loadCancellable,
    );
    if (!responseBytes) return null;

    this.#writeAlbumArtCacheBytes(cacheFile, responseBytes, cacheKey);
    return {
      stream: Gio.MemoryInputStream.new_from_bytes(responseBytes),
      albumArtUri,
      loadedFromCache: false,
      cacheEnabled: Boolean(isCacheEnabled),
    };
  }

  async removeCachedAlbumArt(albumArtUri, cancellable = null) {
    if (!albumArtUri) return;

    const cacheFile = createAlbumArtCacheFile(albumArtUri);
    try {
      await cacheFile.delete_async(GLib.PRIORITY_DEFAULT, cancellable);
    } catch (error) {
      if (!isFileNotFoundError(error))
        logger.warnOnce(
          "cache-delete",
          "Could not remove an invalid album-art cache entry",
          error,
        );
    }
  }

  destroy() {
    this.#session?.abort();
    this.#session = null;
    this.#cacheWriteCancellable?.cancel();
    this.#cacheWriteCancellable = null;
    this.#cachePruneRequested = false;
    this.#cacheDirectoryReady = null;
  }
}
