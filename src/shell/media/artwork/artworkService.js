/**
 * @file artworkService.js
 * @module shell.media.artwork.artworkService
 *
 * Resolves and decodes canonical track artwork for every MediaShell surface.
 *
 * The service owns network I/O, shared in-flight requests, local-track thumbnail
 * fallback, bounded source reads, decode recovery, and the persistent cache. UI
 * owners retain actor lifecycle, per-surface cancellables, stale-generation checks,
 * and presentation transforms.
 */

import GdkPixbuf from "gi://GdkPixbuf";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup";

import { createLogger } from "../../../shared/logging/logger.js";
import { isCancellationError } from "../../utils/errors.js";
import ArtworkCache, { createArtworkCacheKey } from "./artworkCache.js";
import {
  ARTWORK_MAX_BYTES,
  ARTWORK_READ_CHUNK_BYTES,
  ARTWORK_REQUEST_TIMEOUT_SECONDS,
} from "./constants.js";
import { ARTWORK_RENDER_SCALE } from "./presentation.js";

Gio._promisify(Gio.File.prototype, "read_async", "read_finish");
Gio._promisify(Gio.File.prototype, "query_info_async", "query_info_finish");
Gio._promisify(Soup.Session.prototype, "send_async", "send_finish");
Gio._promisify(
  Gio.InputStream.prototype,
  "read_bytes_async",
  "read_bytes_finish",
);
Gio._promisify(Gio.InputStream.prototype, "close_async", "close_finish");
Gio._promisify(
  GdkPixbuf.Pixbuf,
  "new_from_stream_at_scale_async",
  "new_from_stream_finish",
);

const logger = createLogger("ArtworkService");
const FILE_ATTRIBUTES = "standard::type,standard::size";

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

function parseArtworkUri(artworkUri) {
  try {
    return GLib.Uri.parse(artworkUri, GLib.UriFlags.NONE);
  } catch (error) {
    logger.debugOnce(
      `invalid-uri:${artworkUri}`,
      "Ignoring an invalid artwork URI",
      error,
    );
    return null;
  }
}

function closeInputStream(stream) {
  try {
    stream?.close(null);
  } catch {
    // Cancellation or GdkPixbuf may close the stream before surface teardown.
  }
}

/** Owns shared artwork acquisition/cache state for one MediaRuntime. */
export default class ArtworkService {
  #cache = new ArtworkCache();
  #getCacheEnabled = null;
  #remoteRequests = new Map();
  #session = null;

  constructor({ getCacheEnabled = () => false } = {}) {
    this.#getCacheEnabled = getCacheEnabled;
  }

  #isCacheEnabled() {
    return Boolean(this.#getCacheEnabled?.());
  }

  #getSession() {
    this.#session ??= new Soup.Session({
      timeout: ARTWORK_REQUEST_TIMEOUT_SECONDS,
    });
    return this.#session;
  }

  async #openBoundedFileInputStream(file, loadCancellable, sourceKey) {
    if (!file) return null;

    const info = await file.query_info_async(
      FILE_ATTRIBUTES,
      Gio.FileQueryInfoFlags.NONE,
      GLib.PRIORITY_DEFAULT,
      loadCancellable,
    );
    const fileSize = info.get_size();
    if (
      info.get_file_type() !== Gio.FileType.REGULAR ||
      fileSize <= 0 ||
      fileSize > ARTWORK_MAX_BYTES
    ) {
      logger.warnOnce(
        `unsafe-file:${sourceKey}`,
        "Rejected artwork with an unsafe local file size",
        fileSize,
      );
      return null;
    }

    return file.read_async(GLib.PRIORITY_DEFAULT, loadCancellable);
  }

  async #closeNetworkStream(stream) {
    if (!stream) return;

    try {
      await stream.close_async(GLib.PRIORITY_DEFAULT, null);
    } catch (error) {
      if (!isCancellationError(error))
        logger.debugOnce(
          "network-stream-close",
          "Artwork network stream could not be closed",
          error,
        );
    }
  }

  async #readRemoteBytes(httpMessage, loadCancellable) {
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
          "Artwork request returned HTTP status",
          httpStatus,
        );
        return null;
      }

      const declaredLength = httpMessage
        .get_response_headers()
        .get_content_length();
      if (declaredLength > ARTWORK_MAX_BYTES) {
        logger.warnOnce(
          "unsafe-content-length",
          "Rejected artwork with an unsafe declared size",
          declaredLength,
        );
        return null;
      }

      const chunks = [];
      let totalBytes = 0;
      while (true) {
        const remainingBytes = ARTWORK_MAX_BYTES + 1 - totalBytes;
        const responseBytes = await responseStream.read_bytes_async(
          Math.min(ARTWORK_READ_CHUNK_BYTES, remainingBytes),
          GLib.PRIORITY_DEFAULT,
          loadCancellable,
        );
        const chunkSize = responseBytes.get_size();
        if (chunkSize === 0) break;

        totalBytes += chunkSize;
        if (totalBytes > ARTWORK_MAX_BYTES) {
          logger.warnOnce(
            "unsafe-payload-size",
            "Rejected artwork with an unsafe payload size",
            totalBytes,
          );
          return null;
        }
        // Retain GBytes objects until concatenation; their typed-array views
        // must not outlive the native backing storage.
        chunks.push(responseBytes);
      }

      return totalBytes > 0 ? concatenateByteChunks(chunks, totalBytes) : null;
    } finally {
      await this.#closeNetworkStream(responseStream);
    }
  }

  #maybeReleaseRemoteRequest(request) {
    if (
      !request.downloadSettled ||
      request.consumerCount > 0 ||
      (request.cacheWritePromise && !request.cacheWriteSettled)
    )
      return;

    if (this.#remoteRequests.get(request.artworkUri) === request)
      this.#remoteRequests.delete(request.artworkUri);
  }

  #ensureRemoteCacheWrite(request) {
    request.cacheWriteRequested = true;
    if (!request.responseBytes || request.cacheWritePromise || !this.#cache)
      return;

    request.cacheWriteSettled = false;
    const cacheWritePromise = this.#cache
      .persist(request.artworkUri, request.responseBytes)
      .finally(() => {
        request.cacheWriteSettled = true;
        this.#maybeReleaseRemoteRequest(request);
      });
    request.cacheWritePromise = cacheWritePromise;
  }

  #ensureRemoteRequest(artworkUri, uri, cacheEnabled) {
    const existingRequest = this.#remoteRequests.get(artworkUri);
    if (existingRequest && !existingRequest.cancellable.is_cancelled()) {
      if (cacheEnabled) this.#ensureRemoteCacheWrite(existingRequest);
      return existingRequest;
    }
    if (existingRequest) this.#remoteRequests.delete(artworkUri);

    const request = {
      artworkUri,
      cancellable: new Gio.Cancellable(),
      consumerCount: 0,
      downloadSettled: false,
      responseBytes: null,
      cacheWriteRequested: Boolean(cacheEnabled),
      cacheWritePromise: null,
      cacheWriteSettled: true,
      promise: null,
    };
    request.promise = this.#readRemoteBytes(
      new Soup.Message({ method: "GET", uri }),
      request.cancellable,
    );
    request.promise.then(
      (responseBytes) => {
        request.responseBytes = responseBytes;
        request.downloadSettled = true;
        if (responseBytes && request.cacheWriteRequested)
          this.#ensureRemoteCacheWrite(request);
        this.#maybeReleaseRemoteRequest(request);
      },
      () => {
        request.downloadSettled = true;
        this.#maybeReleaseRemoteRequest(request);
      },
    );

    this.#remoteRequests.set(artworkUri, request);
    return request;
  }

  #waitForRemoteRequest(request, loadCancellable) {
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
        this.#maybeReleaseRemoteRequest(request);
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

  async #loadUri(
    artworkUri,
    cacheEnabled,
    loadCancellable,
    { bypassCacheRead = false } = {},
  ) {
    if (!this.#cache || !artworkUri) return null;
    const uri = parseArtworkUri(artworkUri);
    if (!uri) return null;

    const scheme = uri.get_scheme();
    if (scheme === "file") {
      const stream = await this.#openBoundedFileInputStream(
        Gio.File.new_for_uri(uri.to_string()),
        loadCancellable,
        createArtworkCacheKey(artworkUri),
      );
      return stream
        ? {
            stream,
            artworkUri,
            loadedFromCache: false,
            cacheEnabled: Boolean(cacheEnabled),
          }
        : null;
    }

    if (scheme !== "http" && scheme !== "https") {
      logger.debugOnce(
        `unsupported-scheme:${scheme || "none"}`,
        "Ignoring unsupported artwork URI scheme",
        scheme || "none",
      );
      return null;
    }

    const cachedStream =
      cacheEnabled && !bypassCacheRead
        ? await this.#cache.open(artworkUri, loadCancellable)
        : null;
    if (cachedStream)
      return {
        stream: cachedStream,
        artworkUri,
        loadedFromCache: true,
        cacheEnabled: true,
      };

    const remoteRequest = this.#ensureRemoteRequest(
      artworkUri,
      uri,
      cacheEnabled,
    );
    const responseBytes = await this.#waitForRemoteRequest(
      remoteRequest,
      loadCancellable,
    );
    if (!responseBytes) return null;

    return {
      stream: Gio.MemoryInputStream.new_from_bytes(responseBytes),
      artworkUri,
      loadedFromCache: false,
      cacheEnabled: Boolean(cacheEnabled),
    };
  }

  async #tryLoadUri(
    artworkUri,
    cacheEnabled,
    loadCancellable,
    sourceName,
    busName,
  ) {
    if (!artworkUri) return null;
    try {
      return await this.#loadUri(
        artworkUri,
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

  async #resolveSource(request, cacheEnabled, loadCancellable) {
    let fallbackIcon = null;
    let source = await this.#tryLoadUri(
      request.artUrl,
      cacheEnabled,
      loadCancellable,
      "MPRIS artwork",
      request.busName,
    );
    if (source || !request.trackUrl) return { source, fallbackIcon };

    let parsedTrackUri;
    try {
      parsedTrackUri = GLib.Uri.parse(request.trackUrl, GLib.UriFlags.NONE);
    } catch (error) {
      logger.debugOnce(
        `track-uri:${request.busName}`,
        "Ignoring an invalid local track URI",
        error,
      );
      return { source: null, fallbackIcon };
    }
    if (parsedTrackUri.get_scheme() !== "file")
      return { source: null, fallbackIcon };

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
        `track-metadata:${request.busName}`,
        "Local track metadata did not provide artwork",
        error,
      );
      return { source: null, fallbackIcon };
    }

    fallbackIcon = info.get_icon();
    const thumbnailPath = info.get_attribute_byte_string(
      Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH,
    );
    if (thumbnailPath)
      source = await this.#tryLoadUri(
        Gio.File.new_for_path(thumbnailPath).get_uri(),
        cacheEnabled,
        loadCancellable,
        "thumbnail",
        request.busName,
      );

    return { source, fallbackIcon };
  }

  async #decodeStream(stream, size, loadCancellable) {
    if (!stream) return null;
    try {
      const decodeSize = Math.max(1, Math.round(size * ARTWORK_RENDER_SCALE));
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

  async #decodeSource(source, size, loadCancellable) {
    if (!source) return null;

    try {
      return await this.#decodeStream(source.stream, size, loadCancellable);
    } catch (error) {
      if (isCancellationError(error) || !source.loadedFromCache) throw error;

      logger.debugOnce(
        `invalid-cache:${source.artworkUri}`,
        "Discarding an invalid artwork cache entry",
        source.artworkUri,
        error,
      );
      await this.#cache.remove(source.artworkUri, loadCancellable);
      const refreshedSource = await this.#loadUri(
        source.artworkUri,
        source.cacheEnabled,
        loadCancellable,
        { bypassCacheRead: true },
      );
      return this.#decodeStream(
        refreshedSource?.stream ?? null,
        size,
        loadCancellable,
      );
    }
  }

  /** Resolves and decodes one immutable request without taking UI ownership. */
  async load(request, loadCancellable) {
    if (!this.#cache || !request) return { pixbuf: null, fallbackIcon: null };

    const cacheEnabled = this.#isCacheEnabled();
    const { source, fallbackIcon } = await this.#resolveSource(
      request,
      cacheEnabled,
      loadCancellable,
    );
    const pixbuf = await this.#decodeSource(
      source,
      request.width,
      loadCancellable,
    );

    return { pixbuf, fallbackIcon };
  }

  destroy() {
    if (!this.#cache) return;

    for (const request of this.#remoteRequests.values())
      request.cancellable.cancel();
    this.#remoteRequests.clear();

    this.#session?.abort();
    this.#session = null;

    this.#cache.destroy();
    this.#cache = null;
    this.#getCacheEnabled = null;
  }
}
