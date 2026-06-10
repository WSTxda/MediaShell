// Loads local or remote album art without blocking popup rendering and persists an optional cache.
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup";

import { ALBUM_ART_CACHE_DIRECTORY_NAME } from "../../shared/constants/settings.js";
import { createLogger } from "../../shared/utils/log.js";

Gio._promisify(Gio.File.prototype, "read_async", "read_finish");
Gio._promisify(Gio.File.prototype, "delete_async", "delete_finish");
Gio._promisify(Gio.File.prototype, "replace_contents_bytes_async", "replace_contents_finish");
Gio._promisify(Soup.Session.prototype, "send_async", "send_finish");
Gio._promisify(Gio.InputStream.prototype, "read_bytes_async", "read_bytes_finish");
Gio._promisify(Gio.InputStream.prototype, "close_async", "close_finish");

const logger = createLogger("AlbumArtLoader");
let session = null;
let cacheWriteCancellable = null;
const albumArtCacheDirectoryPath = GLib.build_filenamev([GLib.get_user_cache_dir(), ALBUM_ART_CACHE_DIRECTORY_NAME]);
const MAX_ALBUM_ART_BYTES = 16 * 1024 * 1024;
const ALBUM_ART_READ_CHUNK_BYTES = 64 * 1024;
const ALBUM_ART_REQUEST_TIMEOUT_SECONDS = 15;
let albumArtCacheDirectoryReady = null;

function getSession() {
    session ??= new Soup.Session({ timeout: ALBUM_ART_REQUEST_TIMEOUT_SECONDS });
    return session;
}

function getCacheWriteCancellable() {
    if (!cacheWriteCancellable || cacheWriteCancellable.is_cancelled())
        cacheWriteCancellable = new Gio.Cancellable();
    return cacheWriteCancellable;
}

function isCancellationError(error) {
    return Boolean(error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED));
}

function ensureAlbumArtCacheDirectory() {
    if (albumArtCacheDirectoryReady === true) return true;

    const directoryReady = GLib.mkdir_with_parents(albumArtCacheDirectoryPath, 0o755) !== -1;
    if (directoryReady) albumArtCacheDirectoryReady = true;
    else logger.warnOnce("cache-directory", "Album-art cache directory could not be created");
    return directoryReady;
}

function createAlbumArtCacheFile(albumArtUri) {
    const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, albumArtUri, -1);
    return Gio.File.new_for_path(GLib.build_filenamev([albumArtCacheDirectoryPath, hash]));
}

function getAlbumArtCacheFile(albumArtUri) {
    return ensureAlbumArtCacheDirectory() ? createAlbumArtCacheFile(albumArtUri) : null;
}

async function openAlbumArtInputStream(albumArtFile, loadCancellable) {
    if (!albumArtFile) return null;
    return albumArtFile.read_async(GLib.PRIORITY_DEFAULT, loadCancellable);
}

async function openCachedAlbumArtInputStream(cacheFile, loadCancellable) {
    try {
        return await openAlbumArtInputStream(cacheFile, loadCancellable);
    } catch (error) {
        if (isCancellationError(error)) throw error;
        // A missing or stale cache entry is expected and should fall through to the network.
        return null;
    }
}

function writeAlbumArtCacheBytes(cacheFile, responseBytes) {
    if (!cacheFile) return;

    // Cache persistence must not delay the first popup paint.
    cacheFile
        .replace_contents_bytes_async(
            responseBytes,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            getCacheWriteCancellable(),
        )
        .catch((error) => {
            if (!isCancellationError(error))
                logger.debugOnce("cache-persist", "Failed to persist album art in the cache", error);
        });
}


async function closeInputStreamAsync(stream) {
    if (!stream) return;

    try {
        await stream.close_async(GLib.PRIORITY_DEFAULT, null);
    } catch (error) {
        if (!isCancellationError(error)) logger.debugOnce("network-stream-close", "Album-art network stream could not be closed", error);
    }
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

async function readRemoteAlbumArtBytes(httpMessage, loadCancellable) {
    let responseStream = null;
    try {
        responseStream = await getSession().send_async(httpMessage, GLib.PRIORITY_DEFAULT, loadCancellable);
        const httpStatus = httpMessage.get_status();
        if (httpStatus < 200 || httpStatus >= 300) {
            logger.debugOnce(`http-status:${httpStatus}`, "Album-art request returned HTTP status", httpStatus);
            return null;
        }

        const declaredLength = httpMessage.get_response_headers()?.get_content_length?.() ?? -1;
        if (declaredLength > MAX_ALBUM_ART_BYTES) {
            logger.warnOnce("unsafe-content-length", "Rejected album art with an unsafe declared size", declaredLength);
            return null;
        }

        const chunks = [];
        let totalBytes = 0;
        while (true) {
            const remainingBytes = MAX_ALBUM_ART_BYTES + 1 - totalBytes;
            const responseBytes = await responseStream.read_bytes_async(
                Math.min(ALBUM_ART_READ_CHUNK_BYTES, remainingBytes),
                GLib.PRIORITY_DEFAULT,
                loadCancellable,
            );
            const chunkSize = responseBytes.get_size();
            if (chunkSize === 0) break;

            totalBytes += chunkSize;
            if (totalBytes > MAX_ALBUM_ART_BYTES) {
                logger.warnOnce("unsafe-payload-size", "Rejected album art with an unsafe payload size", totalBytes);
                return null;
            }
            // Retain each GBytes object until concatenation so the typed-array
            // view cannot outlive its native backing storage.
            chunks.push(responseBytes);
        }

        return totalBytes > 0 ? concatenateByteChunks(chunks, totalBytes) : null;
    } finally {
        await closeInputStreamAsync(responseStream);
    }
}

function parseAlbumArtUri(albumArtUri) {
    try {
        return GLib.Uri.parse(albumArtUri, GLib.UriFlags.NONE);
    } catch (error) {
        logger.debugOnce(`invalid-uri:${albumArtUri}`, "Ignoring an invalid album-art URI", error);
        return null;
    }
}

export async function loadAlbumArt(albumArtUri, isCacheEnabled, loadCancellable, { bypassCacheRead = false } = {}) {
    if (!albumArtUri) return null;

    const uri = parseAlbumArtUri(albumArtUri);
    if (!uri) return null;

    const scheme = uri.get_scheme();
    if (scheme === "file") {
        const stream = await openAlbumArtInputStream(Gio.File.new_for_uri(uri.to_string()), loadCancellable);
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

    const cacheFile = isCacheEnabled ? getAlbumArtCacheFile(albumArtUri) : null;
    const cachedStream = bypassCacheRead ? null : await openCachedAlbumArtInputStream(cacheFile, loadCancellable);
    if (cachedStream) return { stream: cachedStream, albumArtUri, loadedFromCache: true };

    const httpMessage = new Soup.Message({ method: "GET", uri });
    const responseBytes = await readRemoteAlbumArtBytes(httpMessage, loadCancellable);
    if (!responseBytes) return null;

    writeAlbumArtCacheBytes(cacheFile, responseBytes);
    return {
        stream: Gio.MemoryInputStream.new_from_bytes(responseBytes),
        albumArtUri,
        loadedFromCache: false,
    };
}

export async function removeCachedAlbumArt(albumArtUri, cancellable = null) {
    if (!albumArtUri) return;

    const cacheFile = createAlbumArtCacheFile(albumArtUri);
    try {
        await cacheFile.delete_async(GLib.PRIORITY_DEFAULT, cancellable);
    } catch (error) {
        if (!error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            logger.debugOnce("cache-delete", "Failed to remove an invalid album-art cache entry", error);
    }
}

export function shutdownAlbumArtLoader() {
    session?.abort();
    session = null;
    cacheWriteCancellable?.cancel();
    cacheWriteCancellable = null;
    albumArtCacheDirectoryReady = null;
}
