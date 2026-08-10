/**
 * @file AlbumArtLoader.js
 * @module shell.services.AlbumArtLoader
 *
 * Loads local or remote album art without blocking Shell rendering.
 *
 * The singleton owns the Soup.Session, bounded persistent cache, cache-write
 * cancellable, shared in-flight requests, and album-art cache directory readiness
 * state. Renderers request independent streams from this service while keeping
 * actor ownership local. ExtensionController shuts the service down on disable
 * to abort network work and cancel pending cache writes/pruning.
 *
 * @see src/shell/ui/popup/PopupAlbumArt.js
 * @see src/shell/ui/topBar/TopBarAlbumArt.js
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
  "standard::name,standard::type,standard::size,time::modified,time::modified-usec";
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
  #cacheTouchGeneration = 0;
  #cacheTouchPromises = new Map();
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

  #touchAlbumArtCacheFile(cacheFile, cacheKey) {
    if (!cacheFile || !cacheKey || !this.#cacheWriteCancellable) return;

    // Serialize touches for the same entry so an older asynchronous completion
    // cannot overwrite a newer access time. Cache recency maintenance must not
    // delay the cached stream returned to a renderer.
    this.#cacheTouchGeneration += 1;
    const cancellable = this.#getCacheWriteCancellable();
    if (!cancellable) return;
    const previousTouch = this.#cacheTouchPromises.get(cacheKey);
    const touchPromise = (previousTouch ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!this.#cacheWriteCancellable || cancellable.is_cancelled()) return;

        const info = new Gio.FileInfo();
        info.set_modification_date_time(GLib.DateTime.new_now_utc());
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
          `cache-touch:${cacheKey}`,
          "Album-art cache access time could not be updated",
          error,
        );
      })
      .finally(() => {
        if (this.#cacheTouchPromises.get(cacheKey) !== touchPromise) return;
        this.#cacheTouchPromises.delete(cacheKey);
        if (this.#cacheWriteCancellable) this.#requestAlbumArtCachePrune();
      });

    this.#cacheTouchPromises.set(cacheKey, touchPromise);
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

    const touchGeneration = this.#cacheTouchGeneration;
    const pendingTouches = [...this.#cacheTouchPromises.values()];
    if (pendingTouches.length > 0) await Promise.all(pendingTouches);

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
    // the previous timestamp in this snapshot. Defer eviction to the already
    // coalesced next prune rather than risk deleting an entry just used.
    if (
      touchGeneration !== this.#cacheTouchGeneration ||
      this.#cacheTouchPromises.size > 0
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

  async #removeCachedAlbumArtFile(albumArtUri, cancellable) {
    const cacheFile = createAlbumArtCacheFile(albumArtUri);
    try {
      await cacheFile.delete_async(GLib.PRIORITY_DEFAULT, cancellable);
    } catch (error) {
      if (!isFileNotFoundError(error) && !isCancellationError(error))
        logger.warnOnce(
          "cache-delete",
          "Could not remove an invalid album-art cache entry",
          error,
        );
    }
  }

  #ensureRemoteAlbumArtCacheInvalidation(albumArtUri, request) {
    if (request.cacheInvalidationPromise)
      return request.cacheInvalidationPromise;

    const cancellable = this.#getCacheWriteCancellable();
    if (!cancellable) return Promise.resolve();
    request.cacheInvalidationPromise = this.#removeCachedAlbumArtFile(
      albumArtUri,
      cancellable,
    );
    return request.cacheInvalidationPromise;
  }

  #tryFinalizeRemoteAlbumArtRequest(albumArtUri, request) {
    if (this.#remoteAlbumArtRequests.get(albumArtUri) !== request) return;
    if (!request.responseSettled || request.consumerCount > 0) return;
    if (request.cacheWritePromise && !request.cacheWriteSettled) return;
    this.#remoteAlbumArtRequests.delete(albumArtUri);
  }

  #ensureRemoteAlbumArtCacheWrite(albumArtUri, request) {
    if (
      request.cacheWritePromise ||
      request.cacheWriteSettled ||
      !request.responseBytes ||
      request.cacheWriteConsumerCount <= 0 ||
      !request.cacheFile ||
      !this.#cacheWriteCancellable
    )
      return;

    // Persistence is shared by every consumer of this URI. Keep the resolved
    // request available until the write settles so a renderer arriving in the
    // narrow download-to-disk window can reuse the same bytes immediately.
    request.cacheWritePromise = this.#persistAlbumArtCacheBytes(
      request.cacheFile,
      request.responseBytes,
    )
      .catch((error) => {
        if (!this.#cacheWriteCancellable || isCancellationError(error)) return;
        logger.warnOnce(
          `cache-write:${albumArtUri}`,
          "Unexpected album-art cache persistence failure",
          error,
        );
      })
      .finally(() => {
        request.cacheWriteSettled = true;
        this.#tryFinalizeRemoteAlbumArtRequest(albumArtUri, request);
      });
  }

  #getRemoteAlbumArtRequest(albumArtUri, uri) {
    const existingRequest = this.#remoteAlbumArtRequests.get(albumArtUri);
    if (existingRequest) return existingRequest;

    const request = {
      cancellable: new Gio.Cancellable(),
      consumerCount: 0,
      cacheWriteConsumerCount: 0,
      cacheFile: null,
      cacheInvalidationPromise: null,
      cacheWritePromise: null,
      cacheWriteSettled: false,
      responseBytes: null,
      responseSettled: false,
      promise: null,
    };
    request.promise = this.#readRemoteAlbumArtBytes(
      new Soup.Message({ method: "GET", uri }),
      request.cancellable,
    )
      .then((responseBytes) => {
        request.responseBytes = responseBytes;
        request.responseSettled = true;
        if (responseBytes)
          this.#ensureRemoteAlbumArtCacheWrite(albumArtUri, request);
        return responseBytes;
      })
      .catch((error) => {
        request.responseSettled = true;
        throw error;
      })
      .finally(() => {
        this.#tryFinalizeRemoteAlbumArtRequest(albumArtUri, request);
      });
    this.#remoteAlbumArtRequests.set(albumArtUri, request);
    return request;
  }

  #acquireRemoteAlbumArtRequest(albumArtUri, uri, cacheFile) {
    const request = this.#getRemoteAlbumArtRequest(albumArtUri, uri);
    const cacheWriteRequested = Boolean(cacheFile);
    request.consumerCount++;
    if (cacheWriteRequested) {
      request.cacheWriteConsumerCount++;
      request.cacheFile ??= cacheFile;
      if (request.responseSettled && request.responseBytes)
        this.#ensureRemoteAlbumArtCacheWrite(albumArtUri, request);
    }

    return { albumArtUri, request, cacheWriteRequested };
  }

  #releaseRemoteAlbumArtConsumer(consumer) {
    const { albumArtUri, request, cacheWriteRequested } = consumer;
    request.consumerCount--;
    if (cacheWriteRequested) request.cacheWriteConsumerCount--;

    if (!request.responseSettled && request.consumerCount === 0) {
      // No renderer can use this in-flight result anymore. Remove it before
      // cancellation so a later request never joins a request already dying.
      if (this.#remoteAlbumArtRequests.get(albumArtUri) === request)
        this.#remoteAlbumArtRequests.delete(albumArtUri);
      request.cancellable.cancel();
      return;
    }

    this.#tryFinalizeRemoteAlbumArtRequest(albumArtUri, request);
  }

  async #waitForRemoteAlbumArtRequest(consumer, loadCancellable) {
    const cancelledResult = Symbol("cancelled-album-art-consumer");
    let cancellationSignalId = 0;

    try {
      if (!loadCancellable) return await consumer.request.promise;

      // GCancellable.connect() also covers cancellation racing with this
      // subscription, including a cancellable that is already cancelled.
      const cancellationPromise = new Promise((resolve) => {
        cancellationSignalId = loadCancellable.connect(() => {
          resolve(cancelledResult);
        });
      });
      const result = await Promise.race([
        consumer.request.promise,
        cancellationPromise,
      ]);
      return result === cancelledResult ? null : result;
    } finally {
      // Promise continuations run after the cancellation callback returns, so
      // disconnecting here cannot call GCancellable.disconnect() from inside
      // its own callback (which GLib documents as a deadlock).
      if (cancellationSignalId !== 0)
        loadCancellable.disconnect(cancellationSignalId);
    }
  }

  async #loadRemoteAlbumArtSource(
    albumArtUri,
    uri,
    cacheFile,
    cacheEnabled,
    loadCancellable,
    refreshCache = false,
  ) {
    const remoteConsumer = this.#acquireRemoteAlbumArtRequest(
      albumArtUri,
      uri,
      cacheFile,
    );

    try {
      let responseBytes;
      try {
        responseBytes = await this.#waitForRemoteAlbumArtRequest(
          remoteConsumer,
          loadCancellable,
        );
      } catch (error) {
        if (
          refreshCache &&
          !isCancellationError(error) &&
          !loadCancellable?.is_cancelled()
        )
          await this.#ensureRemoteAlbumArtCacheInvalidation(
            albumArtUri,
            remoteConsumer.request,
          );
        throw error;
      }

      if (!responseBytes) {
        if (refreshCache && !loadCancellable?.is_cancelled())
          await this.#ensureRemoteAlbumArtCacheInvalidation(
            albumArtUri,
            remoteConsumer.request,
          );
        return null;
      }

      return {
        stream: Gio.MemoryInputStream.new_from_bytes(responseBytes),
        albumArtUri,
        loadedFromCache: false,
        cacheEnabled: Boolean(cacheEnabled),
      };
    } finally {
      this.#releaseRemoteAlbumArtConsumer(remoteConsumer);
    }
  }

  async loadAlbumArt(
    albumArtUri,
    isCacheEnabled,
    loadCancellable,
    { refreshCache = false } = {},
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

    // A renderer already fetching this URI is the freshest source. Join it
    // before touching persistent cache so popup and top bar never race the
    // same remote artwork through separate paths.
    if (this.#remoteAlbumArtRequests.has(albumArtUri))
      return this.#loadRemoteAlbumArtSource(
        albumArtUri,
        uri,
        cacheFile,
        isCacheEnabled,
        loadCancellable,
        refreshCache,
      );

    const cachedStream =
      !isCacheEnabled || refreshCache
        ? null
        : await this.#openCachedAlbumArtInputStream(
            cacheFile,
            loadCancellable,
            cacheKey,
          );
    if (cachedStream) {
      this.#touchAlbumArtCacheFile(cacheFile, cacheKey);
      return {
        stream: cachedStream,
        albumArtUri,
        loadedFromCache: true,
        cacheEnabled: Boolean(isCacheEnabled),
      };
    }

    return this.#loadRemoteAlbumArtSource(
      albumArtUri,
      uri,
      cacheFile,
      isCacheEnabled,
      loadCancellable,
      refreshCache,
    );
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
    this.#cacheTouchPromises.clear();
    this.#cacheDirectoryReady = null;
  }
}
