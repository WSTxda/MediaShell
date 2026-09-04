/**
 * @file albumArtCacheService.js
 * @module prefs.services.albumArtCacheService
 *
 * Provides preferences-side maintenance for the album-art cache directory.
 *
 * OthersPageController uses this utility to inspect and clear cached album art
 * without importing Shell runtime services. It operates only on files under the
 * configured MediaShell cache directory.
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
    // The Shell process may replace or discard a cache entry after the
    // preferences process enumerates it. The desired result is already met.
    if (!isFileNotFoundError(error)) throw error;
  }
}

/**
 * Provides preferences-side maintenance for the album-art cache directory.
 */
export default class AlbumArtCacheService {
  constructor() {
    this.albumArtCacheOperationCancellable = new Gio.Cancellable();
  }

  get albumArtCacheDirectory() {
    return Gio.File.new_for_path(
      GLib.build_filenamev([GLib.get_user_cache_dir(), EXTENSION_UUID]),
    );
  }

  async getAlbumArtCacheStats() {
    if (
      !this.albumArtCacheDirectory.query_exists(
        this.albumArtCacheOperationCancellable,
      )
    )
      return { cachedImageCount: 0, totalBytes: 0 };

    let cachedImageCount = 0;
    let totalBytes = 0;
    await this.forEachAlbumArtCacheBatch((entries) => {
      for (const { info } of entries) {
        if (info.get_file_type() !== Gio.FileType.REGULAR) continue;
        cachedImageCount++;
        totalBytes += info.get_size();
      }
    });
    return { cachedImageCount, totalBytes };
  }

  async clearAlbumArtCache() {
    if (
      !this.albumArtCacheDirectory.query_exists(
        this.albumArtCacheOperationCancellable,
      )
    )
      return;

    await this.forEachAlbumArtCacheBatch(async (entries) => {
      const cacheFiles = entries.filter(
        ({ info }) => info.get_file_type() === Gio.FileType.REGULAR,
      );
      await Promise.all(
        cacheFiles.map(({ file }) =>
          deleteCacheFile(file, this.albumArtCacheOperationCancellable),
        ),
      );
    });
  }

  async forEachAlbumArtCacheBatch(callback) {
    const enumerator =
      await this.albumArtCacheDirectory.enumerate_children_async(
        "standard::name,standard::type,standard::size",
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        GLib.PRIORITY_DEFAULT,
        this.albumArtCacheOperationCancellable,
      );

    try {
      while (true) {
        const infos = await enumerator.next_files_async(
          64,
          GLib.PRIORITY_DEFAULT,
          this.albumArtCacheOperationCancellable,
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
          this.albumArtCacheOperationCancellable,
        );
      } catch {
        // Cancellation may close the enumerator before the finally block.
      }
    }
  }

  destroy() {
    // Keep the canceled object referenced so an operation that resumes after
    // an await cannot silently continue with a null cancellable.
    this.albumArtCacheOperationCancellable.cancel();
  }
}
