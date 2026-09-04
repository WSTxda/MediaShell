/**
 * @file artworkCacheService.js
 * @module prefs.services.artworkCacheService
 *
 * Provides preferences-side maintenance for MediaShell's persistent artwork cache.
 *
 * This service deliberately does not import the Shell runtime ArtworkCache. The
 * preferences process operates on the same cache directory through asynchronous
 * Gio APIs, treats a missing directory as an empty cache, and owns one cancellable
 * for every in-flight maintenance operation.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { EXTENSION_UUID } from "../../shared/project.js";

Gio._promisify(Gio.File.prototype, "delete_async", "delete_finish");
Gio._promisify(
  Gio.File.prototype,
  "enumerate_children_async",
  "enumerate_children_finish",
);
Gio._promisify(
  Gio.FileEnumerator.prototype,
  "next_files_async",
  "next_files_finish",
);
Gio._promisify(Gio.FileEnumerator.prototype, "close_async", "close_finish");

function isFileNotFoundError(error) {
  return Boolean(error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND));
}

async function deleteCacheFile(file, cancellable) {
  try {
    await file.delete_async(GLib.PRIORITY_DEFAULT, cancellable);
  } catch (error) {
    // The Shell process may replace or discard a cache entry after Preferences
    // enumerates it. NOT_FOUND therefore already represents the desired result.
    if (!isFileNotFoundError(error)) throw error;
  }
}

/** Provides preferences-side inspection and clearing of the artwork cache. */
export default class ArtworkCacheService {
  constructor() {
    this.operationCancellable = new Gio.Cancellable();
  }

  get cacheDirectory() {
    return Gio.File.new_for_path(
      GLib.build_filenamev([GLib.get_user_cache_dir(), EXTENSION_UUID]),
    );
  }

  async getArtworkCacheStats() {
    let cachedImageCount = 0;
    let totalBytes = 0;

    await this.forEachCacheBatch((entries) => {
      for (const { info } of entries) {
        if (info.get_file_type() !== Gio.FileType.REGULAR) continue;
        cachedImageCount++;
        totalBytes += info.get_size();
      }
    });

    return { cachedImageCount, totalBytes };
  }

  async clearArtworkCache() {
    await this.forEachCacheBatch(async (entries) => {
      const cacheFiles = entries.filter(
        ({ info }) => info.get_file_type() === Gio.FileType.REGULAR,
      );
      await Promise.all(
        cacheFiles.map(({ file }) =>
          deleteCacheFile(file, this.operationCancellable),
        ),
      );
    });
  }

  async forEachCacheBatch(callback) {
    let enumerator;
    try {
      enumerator = await this.cacheDirectory.enumerate_children_async(
        "standard::name,standard::type,standard::size",
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        GLib.PRIORITY_DEFAULT,
        this.operationCancellable,
      );
    } catch (error) {
      // Avoid synchronous query_exists()/check-then-act I/O. A cache directory
      // that has not been created yet is simply an empty cache.
      if (isFileNotFoundError(error)) return;
      throw error;
    }

    try {
      while (true) {
        const infos = await enumerator.next_files_async(
          64,
          GLib.PRIORITY_DEFAULT,
          this.operationCancellable,
        );
        if (infos.length === 0) break;
        await callback(
          infos.map((info) => ({ info, file: enumerator.get_child(info) })),
        );
      }
    } finally {
      try {
        await enumerator.close_async(
          GLib.PRIORITY_DEFAULT,
          this.operationCancellable,
        );
      } catch {
        // Cancellation may close the enumerator before this finally block.
      }
    }
  }

  destroy() {
    // Keep the canceled object referenced so an operation that resumes after an
    // await cannot continue with a replaced or null cancellable.
    this.operationCancellable.cancel();
  }
}
