/**
 * @file artworkCache.js
 * @module shell.media.artwork.artworkCache
 *
 * Owns MediaShell's bounded persistent artwork cache.
 *
 * The cache owns its directory readiness, access-time serialization, background
 * writes, coalesced LRU pruning, and teardown cancellable. ArtworkService is the
 * only runtime consumer; Shell surfaces never touch cache files directly.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { EXTENSION_UUID } from "../../../shared/project.js";
import { createLogger } from "../../../shared/logging/logger.js";
import { isCancellationError } from "../../platform/gioErrors.js";
import { ARTWORK_CACHE_MAX_BYTES, ARTWORK_MAX_BYTES } from "./constants.js";
import { selectArtworkCacheEvictions } from "./cachePolicy.js";

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

const logger = createLogger("ArtworkCache");
const CACHE_FILE_ATTRIBUTES = "standard::type,standard::size";
const CACHE_DIRECTORY_ATTRIBUTES =
  "standard::name,standard::type,standard::size,time::access,time::access-usec,time::modified,time::modified-usec";
const cacheDirectoryPath = GLib.build_filenamev([
  GLib.get_user_cache_dir(),
  EXTENSION_UUID,
]);

function isFileNotFoundError(error) {
  return Boolean(error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND));
}

/** Creates the deterministic on-disk key for one remote artwork URI. */
export function createArtworkCacheKey(artworkUri) {
  return GLib.compute_checksum_for_string(
    GLib.ChecksumType.SHA256,
    artworkUri,
    -1,
  );
}

function createCacheFile(artworkUri) {
  return Gio.File.new_for_path(
    GLib.build_filenamev([
      cacheDirectoryPath,
      createArtworkCacheKey(artworkUri),
    ]),
  );
}

/** Owns all persistent artwork-cache filesystem state and background work. */
export default class ArtworkCache {
  #directoryReady = null;
  #prunePromise = null;
  #pruneRequested = false;
  #accessGeneration = 0;
  #accessPromises = new Map();
  #cancellable = new Gio.Cancellable();

  #getCancellable() {
    return this.#cancellable;
  }

  #invalidateDirectoryIfMissing(error) {
    if (!isFileNotFoundError(error)) return false;
    this.#directoryReady = null;
    return true;
  }

  #ensureDirectory() {
    if (!this.#cancellable) return false;
    if (this.#directoryReady === true) return true;

    const ready = GLib.mkdir_with_parents(cacheDirectoryPath, 0o755) !== -1;
    if (ready) this.#directoryReady = true;
    else
      logger.warnOnce(
        "directory",
        "Artwork cache directory could not be created",
      );
    return ready;
  }

  #getFile(artworkUri) {
    return this.#ensureDirectory() ? createCacheFile(artworkUri) : null;
  }

  async open(artworkUri, loadCancellable) {
    if (!this.#cancellable || !artworkUri) return null;

    const cacheKey = createArtworkCacheKey(artworkUri);
    const cacheFile = this.#getFile(artworkUri);
    if (!cacheFile) return null;

    try {
      const info = await cacheFile.query_info_async(
        CACHE_FILE_ATTRIBUTES,
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
          `unsafe-file:${cacheKey}`,
          "Rejected artwork cache entry with an unsafe file size",
          fileSize,
        );
        return null;
      }

      const stream = await cacheFile.read_async(
        GLib.PRIORITY_DEFAULT,
        loadCancellable,
      );
      this.#markAccessed(cacheFile, cacheKey);
      return stream;
    } catch (error) {
      if (isCancellationError(error)) throw error;
      return null;
    }
  }

  #markAccessed(cacheFile, cacheKey) {
    if (!cacheFile || !cacheKey || !this.#cancellable) return;

    // Serialize updates per entry so an older completion cannot overwrite a
    // newer access time. atime is deliberately used so mtime remains content age.
    this.#accessGeneration += 1;
    const cancellable = this.#getCancellable();
    if (!cancellable) return;

    const previousAccess = this.#accessPromises.get(cacheKey);
    const accessPromise = (previousAccess ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (!this.#cancellable || cancellable.is_cancelled()) return;

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
        if (!this.#cancellable || isCancellationError(error)) return;
        if (this.#invalidateDirectoryIfMissing(error)) return;
        logger.debugOnce(
          `access:${cacheKey}`,
          "Artwork cache access time could not be updated",
          error,
        );
      })
      .finally(() => {
        if (this.#accessPromises.get(cacheKey) === accessPromise)
          this.#accessPromises.delete(cacheKey);
      });

    this.#accessPromises.set(cacheKey, accessPromise);
  }

  async persist(artworkUri, responseBytes) {
    if (!this.#cancellable || !artworkUri || !responseBytes) return;

    let recoveredMissingDirectory = false;
    while (this.#cancellable) {
      const cancellable = this.#getCancellable();
      if (!cancellable) return;

      const cacheFile = this.#getFile(artworkUri);
      if (!cacheFile) return;

      try {
        await cacheFile.replace_contents_bytes_async(
          responseBytes,
          null,
          false,
          Gio.FileCreateFlags.REPLACE_DESTINATION,
          cancellable,
        );
        if (this.#cancellable) this.#requestPrune();
        return;
      } catch (error) {
        if (!this.#cancellable || isCancellationError(error)) return;

        const directoryMissing = this.#invalidateDirectoryIfMissing(error);
        if (
          directoryMissing &&
          !recoveredMissingDirectory &&
          this.#ensureDirectory()
        ) {
          recoveredMissingDirectory = true;
          continue;
        }

        logger.warnOnce(
          "write",
          "Failed to persist artwork in the cache",
          error,
        );
        return;
      }
    }
  }

  #requestPrune() {
    if (!this.#cancellable) return;

    this.#pruneRequested = true;
    if (this.#prunePromise) return;

    const prunePromise = (async () => {
      while (this.#pruneRequested && this.#cancellable) {
        const cancellable = this.#getCancellable();
        if (!cancellable || cancellable.is_cancelled()) return;

        this.#pruneRequested = false;
        await this.#pruneOnce();
      }
    })()
      .catch((error) => {
        if (!this.#cancellable || isCancellationError(error)) return;
        if (this.#invalidateDirectoryIfMissing(error)) return;
        logger.warnOnce("prune", "Artwork cache pruning failed", error);
      })
      .finally(() => {
        if (this.#prunePromise === prunePromise) this.#prunePromise = null;
        if (this.#pruneRequested && this.#cancellable) this.#requestPrune();
      });

    this.#prunePromise = prunePromise;
  }

  async #pruneOnce() {
    if (!this.#cancellable || !this.#ensureDirectory()) return;

    const accessGeneration = this.#accessGeneration;
    const pendingAccessUpdates = [...this.#accessPromises.values()];
    if (pendingAccessUpdates.length > 0)
      await Promise.all(pendingAccessUpdates);

    const cancellable = this.#getCancellable();
    if (!cancellable) return;

    const cacheDirectory = Gio.File.new_for_path(cacheDirectoryPath);
    const enumerator = await cacheDirectory.enumerate_children_async(
      CACHE_DIRECTORY_ATTRIBUTES,
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
            "enumerator-close",
            "Artwork cache enumerator could not be closed",
            error,
          );
      }
    }

    // A hit beginning during enumeration may still have an older access time
    // in this snapshot. Defer eviction rather than deleting a just-used entry.
    if (
      accessGeneration !== this.#accessGeneration ||
      this.#accessPromises.size > 0
    ) {
      this.#pruneRequested = true;
      return;
    }

    const evictions = selectArtworkCacheEvictions(
      entries,
      ARTWORK_CACHE_MAX_BYTES,
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

  async remove(artworkUri, cancellable = null) {
    if (!artworkUri) return;

    try {
      await createCacheFile(artworkUri).delete_async(
        GLib.PRIORITY_DEFAULT,
        cancellable,
      );
    } catch (error) {
      if (!isFileNotFoundError(error))
        logger.warnOnce(
          "delete",
          "Could not remove an invalid artwork cache entry",
          error,
        );
    }
  }

  destroy() {
    const cancellable = this.#cancellable;
    if (!cancellable) return;

    this.#cancellable = null;
    cancellable.cancel();
    this.#pruneRequested = false;
    this.#accessPromises.clear();
    this.#directoryReady = null;
  }
}
