/**
 * @file albumArtLoader.js
 * @module shell.services.albumArtLoader
 *
 * Loads local or remote album art without blocking Shell rendering.
 *
 * One ExtensionController-owned instance owns the Soup.Session, bounded
 * persistent cache, cache-write cancellable, shared in-flight requests, and
 * album-art cache directory readiness state. Renderers request independent
 * streams from this service while keeping actor ownership local. Teardown aborts
 * network work and cancels pending cache writes and pruning.
 *
 * @see src/shell/ui/popup/popupAlbumArt.js
 * @see src/shell/ui/topbar/topBarAlbumArt.js
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup";

import {
  ALBUM_ART_CACHE_MAX_BYTES,
  ALBUM_ART_MAX_BYTES,
  ALBUM_ART_READ_CHUNK_BYTES,
  ALBUM_ART_REQUEST_TIMEOUT_SECONDS,
} from "../constants/albumArt.js";
import { EXTENSION_UUID } from "../../shared/constants/project.js";
import { selectAlbumArtCacheEvictions } from "../../shared/utils/albumArt.js";
import { createLogger } from "../../shared/utils/log.js";
import { isCancellationError } from "../utils/errors.js";

Gio._promisify(Gio.File.prototype, "read_async", "read_finish");
Gio._promisify(Gio.File.prototype, "delete_async", "delete_finish");
Gio._promisify(Gio.File.prototype, "query_info_async", "query_info_finish");
Gio._promisify(
  Gio.File.prototype,
  "set_attributes_async",
  "set_attributes_finish",
);
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
  "standard::name,standard::type,standard::size,time::access,time::access-usec,time::modified,time::modified-usec";
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
 * Loads local or remote album art without blocking Shell rendering.
 */
export default class AlbumArtLoader {
  #cacheDirectoryReady = null;
  #cachePrunePromise = null;
  #cachePruneRequested = false;
  #cacheAccessGeneration = 0;
  #cacheAccessPromises = new Map();
  #cacheWriteCancellable = new Gio.Cancellable();
  #remoteAlbumArtRequests = new Map();
  #session = null;

  #getSession() {
    this.#session ??= new Soup.Session({
      timeout: ALBUM_ART_REQUEST_TIMEOUT_SECONDS,
    });
    return this.#session;
  }

  #getCacheWriteCancellable() {
    return this.#cacheWriteCancellable;
  }

  #invalidateCacheDirectoryIfMissing(error) {
    if (!isFileNotFoundError(error)) return false;
    this.#cacheDirectoryReady = null;
    return true;
  }

  #ensureAlbumArtCacheDirectory() {
    if (!this.#cacheWriteCancellable) return false;
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

  #markAlbumArtCacheFileAccessed(cacheFile, cacheKey) {
    if (!cacheFile || !cacheKey || !this.#cacheWriteCancellable) return;

    // Serialize updates for the same entry so an older asynchronous completion
    // cannot overwrite a newer access time. Using atime preserves mtime as the
    // content-change timestamp expected by desktop thumbnailers.
    this.#cacheAccessGeneration += 1;
    const cancellable = this.#getCacheWriteCancellable();
    if (!cancellable) return;
    const previousAccess = this.#cacheAccessPromises.get(cacheKey);
    const accessPromise = (previousAccess ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!this.#cacheWriteCancellable || cancellable.is_cancelled()) return;

        const info = new Gio.FileInfo();
        info.set_access_date_time(GLib.DateTime.new_now_utc());
        await cacheFile.set_attributes_async(
          info,
          Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
          GLib.PRIORITY_DEFAULT,
          cancellable,
        );
      })
      .catch((error) => {
        if (!this.#cacheWriteCancellable || isCancellationError(error)) return;
        if (this.#invalidateCacheDirectoryIfMissing(error)) return;
        logger.debugOnce(
          `cache-access:${cacheKey}`,
          "Album-art cache access time could not be updated",
          error,
        );
      })
      .finally(() => {
        if (this.#cacheAccessPromises.get(cacheKey) !== accessPromise) return;
        this.#cacheAccessPromises.delete(cacheKey);
      });

    this.#cacheAccessPromises.set(cacheKey, accessPromise);
  }

  async #persistAlbumArtCacheBytes(cacheFile, responseBytes) {
    let recoveredMissingDirectory = false;

    while (this.#cacheWriteCancellable) {
      const cancellable = this.#getCacheWriteCancellable();
      if (!cancellable) return;

      try {
        await cacheFile.replace_contents_bytes_async(
          responseBytes,
          null,
          false,
          Gio.FileCreateFlags.REPLACE_DESTINATION,
          cancellable,
        );
        if (this.#cacheWriteCancellable) this.#requestAlbumArtCachePrune();
        return;
      } catch (error) {
        if (!this.#cacheWriteCancellable || isCancellationError(error)) return;

        const cacheDirectoryMissing =
          this.#invalidateCacheDirectoryIfMissing(error);
        if (
          cacheDirectoryMissing &&
          !recoveredMissingDirectory &&
          this.#ensureAlbumArtCacheDirectory()
        ) {
          recoveredMissingDirectory = true;
          continue;
        }

        logger.warnOnce(
          "cache-write",
          "Failed to persist album art in the cache",
          error,
        );
        return;
      }
    }
  }

  #requestAlbumArtCachePrune() {
    if (!this.#cacheWriteCancellable) return;

    this.#cachePruneRequested = true;
    if (this.#cachePrunePromise) return;

    const prunePromise = (async () => {
      while (this.#cachePruneRequested && this.#cacheWriteCancellable) {
        const cancellable = this.#getCacheWriteCancellable();
        if (!cancellable || cancellable.is_cancelled()) return;

        this.#cachePruneRequested = false;
        await this.#pruneAlbumArtCacheOnce();
      }
    })()
      .catch((error) => {
        if (!this.#cacheWriteCancellable || isCancellationError(error)) return;
        if (this.#invalidateCacheDirectoryIfMissing(error)) return;
        logger.warnOnce("cache-prune", "Album-art cache pruning failed", error);
      })
      .finally(() => {
        if (this.#cachePrunePromise === prunePromise)
          this.#cachePrunePromise = null;
        if (this.#cachePruneRequested && this.#cacheWriteCancellable)
          this.#requestAlbumArtCachePrune();
      });
    this.#cachePrunePromise = prunePromise;
  }

  async #pruneAlbumArtCacheOnce() {
    if (!this.#cacheWriteCancellable || !this.#ensureAlbumArtCacheDirectory())
      return;

    const accessGeneration = this.#cacheAccessGeneration;
    const pendingAccessUpdates = [...this.#cacheAccessPromises.values()];
    if (pendingAccessUpdates.length > 0)
      await Promise.all(pendingAccessUpdates);

    const cancellable = this.#getCacheWriteCancellable();
    if (!cancellable) return;

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
            accessedSeconds: info.has_attribute("time::access")
              ? info.get_attribute_uint64("time::access")
              : undefined,
            accessedMicroseconds: info.has_attribute("time::access-usec")
              ? info.get_attribute_uint32("time::access-usec")
              : undefined,
            modifiedSeconds: info.get_attribute_uint64("time::modified"),
            modifiedMicroseconds: info.get_attribute_uint32(
              "time::modified-usec",
            ),
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

    // A cache hit that begins while enumeration is in progress may still have
    // the previous access timestamp in this snapshot. Defer eviction to the
    // already coalesced next prune rather than delete an entry just used.
    if (
      accessGeneration !== this.#cacheAccessGeneration ||
      this.#cacheAccessPromises.size > 0
    ) {
      this.#cachePruneRequested = true;
      return;
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

      const declaredLength = httpMessage
        .get_response_headers()
        .get_content_length();
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

  #maybeReleaseRemoteAlbumArtRequest(request) {
    if (
      !request.downloadSettled ||
      request.consumerCount > 0 ||
      (request.cacheWritePromise && !request.cacheWriteSettled)
    )
      return;

    if (this.#remoteAlbumArtRequests.get(request.albumArtUri) === request)
      this.#remoteAlbumArtRequests.delete(request.albumArtUri);
  }

  #ensureRemoteAlbumArtCacheWrite(request, cacheFile) {
    if (!cacheFile || !this.#cacheWriteCancellable) return;

    request.cacheFile ??= cacheFile;
    if (!request.responseBytes || request.cacheWritePromise) return;

    request.cacheWriteSettled = false;
    const cacheWritePromise = this.#persistAlbumArtCacheBytes(
      request.cacheFile,
      request.responseBytes,
    ).finally(() => {
      request.cacheWriteSettled = true;
      this.#maybeReleaseRemoteAlbumArtRequest(request);
    });
    request.cacheWritePromise = cacheWritePromise;
  }

  #ensureRemoteAlbumArtRequest(albumArtUri, uri, cacheFile) {
    const existingRequest = this.#remoteAlbumArtRequests.get(albumArtUri);
    if (existingRequest && !existingRequest.cancellable.is_cancelled()) {
      this.#ensureRemoteAlbumArtCacheWrite(existingRequest, cacheFile);
      return existingRequest;
    }
    if (existingRequest) this.#remoteAlbumArtRequests.delete(albumArtUri);

    const request = {
      albumArtUri,
      cancellable: new Gio.Cancellable(),
      consumerCount: 0,
      downloadSettled: false,
      responseBytes: null,
      cacheFile: cacheFile ?? null,
      cacheWritePromise: null,
      cacheWriteSettled: true,
      promise: null,
    };
    request.promise = this.#readRemoteAlbumArtBytes(
      new Soup.Message({ method: "GET", uri }),
      request.cancellable,
    );
    request.promise.then(
      (responseBytes) => {
        request.responseBytes = responseBytes;
        request.downloadSettled = true;
        if (responseBytes)
          this.#ensureRemoteAlbumArtCacheWrite(request, request.cacheFile);
        this.#maybeReleaseRemoteAlbumArtRequest(request);
      },
      () => {
        request.downloadSettled = true;
        this.#maybeReleaseRemoteAlbumArtRequest(request);
      },
    );

    this.#remoteAlbumArtRequests.set(albumArtUri, request);
    return request;
  }

  #waitForRemoteAlbumArtRequest(request, loadCancellable) {
    request.consumerCount += 1;

    return new Promise((resolve, reject) => {
      let settled = false;
      let released = false;
      let cancellationSignalId = null;

      const releaseConsumer = () => {
        if (released) return;
        released = true;
        request.consumerCount = Math.max(0, request.consumerCount - 1);
        if (
          request.consumerCount === 0 &&
          !request.downloadSettled &&
          !request.cancellable.is_cancelled()
        )
          request.cancellable.cancel();
        this.#maybeReleaseRemoteAlbumArtRequest(request);
      };

      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        releaseConsumer();
        callback(value);
      };

      const disconnectCancellationSignal = () => {
        if (cancellationSignalId === null || !loadCancellable) return;
        loadCancellable.disconnect(cancellationSignalId);
        cancellationSignalId = null;
      };

      if (loadCancellable?.is_cancelled()) {
        settle(resolve, null);
        return;
      }

      cancellationSignalId =
        loadCancellable?.connect(() => settle(resolve, null)) ?? null;
      request.promise.then(
        (responseBytes) => {
          disconnectCancellationSignal();
          settle(resolve, responseBytes);
        },
        (error) => {
          disconnectCancellationSignal();
          settle(reject, error);
        },
      );
    });
  }

  async loadAlbumArt(
    albumArtUri,
    isCacheEnabled,
    loadCancellable,
    { bypassCacheRead = false } = {},
  ) {
    if (!this.#cacheWriteCancellable || !albumArtUri) return null;
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
      this.#markAlbumArtCacheFileAccessed(cacheFile, cacheKey);
      return {
        stream: cachedStream,
        albumArtUri,
        loadedFromCache: true,
        cacheEnabled: Boolean(isCacheEnabled),
      };
    }

    const remoteRequest = this.#ensureRemoteAlbumArtRequest(
      albumArtUri,
      uri,
      cacheFile,
    );
    const responseBytes = await this.#waitForRemoteAlbumArtRequest(
      remoteRequest,
      loadCancellable,
    );
    if (!responseBytes) return null;

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
    const cacheWriteCancellable = this.#cacheWriteCancellable;
    if (!cacheWriteCancellable) return;

    this.#cacheWriteCancellable = null;
    for (const request of this.#remoteAlbumArtRequests.values())
      request.cancellable.cancel();
    this.#remoteAlbumArtRequests.clear();
    this.#session?.abort();
    this.#session = null;
    cacheWriteCancellable.cancel();
    this.#cachePruneRequested = false;
    this.#cacheAccessPromises.clear();
    this.#cacheDirectoryReady = null;
  }
}
