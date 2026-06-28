/**
 * @file AlbumArtCacheService.js
 * @module prefs.utils.AlbumArtCacheService
 *
 * Provides preferences-side maintenance for the album-art cache directory.
 *
 * OthersPageController uses this utility to inspect and clear cached album art
 * without importing Shell runtime services. It operates only on files under the
 * configured MediaShell cache directory.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { ALBUM_ART_CACHE_DIRECTORY_NAME } from "../../shared/constants/settings.js";
import { createLogger } from "../../shared/utils/log.js";

Gio._promisify(Gio.File.prototype, "delete_async", "delete_finish");
Gio._promisify(Gio.File.prototype, "enumerate_children_async", "enumerate_children_finish");
Gio._promisify(Gio.FileEnumerator.prototype, "next_files_async", "next_files_finish");
Gio._promisify(Gio.FileEnumerator.prototype, "close_async", "close_finish");

const logger = createLogger("AlbumArtCacheService");

/**
 * Provides preferences-side maintenance for the album-art cache directory.
 */
export default class AlbumArtCacheService {
    constructor() {
        this.albumArtCacheOperationCancellable = new Gio.Cancellable();
    }

    get albumArtCacheDirectory() {
        return Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_cache_dir(), ALBUM_ART_CACHE_DIRECTORY_NAME]));
    }

    async getAlbumArtCacheStats() {
        if (!this.albumArtCacheDirectory.query_exists(this.albumArtCacheOperationCancellable))
            return { coverCount: 0, totalBytes: 0 };

        let coverCount = 0;
        let totalBytes = 0;
        await this.forEachAlbumArtCacheBatch((entries) => {
            for (const { info } of entries) {
                if (info.get_file_type() !== Gio.FileType.REGULAR) continue;
                coverCount++;
                totalBytes += info.get_size();
            }
        });
        return { coverCount, totalBytes };
    }

    async clearAlbumArtCache() {
        if (!this.albumArtCacheDirectory.query_exists(this.albumArtCacheOperationCancellable)) return;

        await this.forEachAlbumArtCacheBatch(async (entries) => {
            const results = await Promise.allSettled(
                entries.map(({ file }) =>
                    file.delete_async(GLib.PRIORITY_DEFAULT, this.albumArtCacheOperationCancellable),
                ),
            );
            const failure = results.find((result) => result.status === "rejected");
            if (failure) throw failure.reason;
        });
    }

    async forEachAlbumArtCacheBatch(callback) {
        const enumerator = await this.albumArtCacheDirectory.enumerate_children_async(
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
                await callback(infos.map((info) => ({ info, file: enumerator.get_child(info) })));
            }
        } finally {
            try {
                await enumerator.close_async(GLib.PRIORITY_DEFAULT, this.albumArtCacheOperationCancellable);
            } catch (error) {
                logger.debug("Cache enumerator was already closed", error);
            }
        }
    }

    destroy() {
        // Keep the cancelled object referenced so an operation that resumes after
        // an await cannot silently continue with a null cancellable.
        this.albumArtCacheOperationCancellable.cancel();
    }
}
