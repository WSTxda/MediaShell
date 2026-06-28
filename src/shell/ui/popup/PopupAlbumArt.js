/**
 * @file PopupAlbumArt.js
 * @module shell.ui.popup.PopupAlbumArt
 *
 * Owns popup album-art loading, safe fallbacks, square cropping, and actor lifecycle.
 *
 * PopupContent delegates cover art to this component so async file/network loads
 * are isolated from the rest of the popup. The component cancels stale loads by
 * generation, decodes images into Shell textures, and falls back to a themed icon.
 */

import Clutter from "gi://Clutter";
import GdkPixbuf from "gi://GdkPixbuf";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";

import { IconNames } from "../../../shared/constants/icons.js";
import { POPUP_ALBUM_ART_CORNER_RADIUS } from "../../../shared/constants/settings.js";
import { createLogger } from "../../../shared/utils/log.js";
import { ALBUM_ART_OUTLINE_WIDTH } from "../../constants/popup.js";
import AlbumArtLoader from "../../services/AlbumArtLoader.js";
import { isCancellationError } from "../../utils/errors.js";
import { createIcon, setGIcon } from "../../utils/icons.js";

Gio._promisify(GdkPixbuf.Pixbuf, "new_from_stream_at_scale_async", "new_from_stream_finish");
Gio._promisify(Gio.File.prototype, "query_info_async", "query_info_finish");

const logger = createLogger("PopupAlbumArt");

/**
 * Owns popup album-art loading, safe fallbacks, square cropping, and actor lifecycle.
 */
export default class PopupAlbumArt {
    constructor(popupContent) {
        this.popupContent = popupContent;
        this.albumArtLoadGeneration = 0;
        this.albumArtLoadCancellable = null;
        this.loadedAlbumArtKey = null;
        this.loadingAlbumArtKey = null;
        this.albumArtLoader = AlbumArtLoader.getInstance();
        this.fallbackAlbumArtIcon = Gio.ThemedIcon.new_from_names([IconNames.MEDIA, IconNames.MISSING]);
    }

    get extensionController() {
        return this.popupContent.extensionController;
    }
    get mediaApp() {
        return this.popupContent.mediaApp;
    }
    get popupItem() {
        return this.popupContent.popupItem;
    }
    get appSelectorActor() {
        return this.popupContent.appSelectorController.actor;
    }
    get actor() {
        return this.albumArtFrame;
    }

    getAlbumArtWidth() {
        return this.popupContent.getAlbumArtWidth();
    }

    cancelAlbumArtLoad() {
        if (!this.albumArtLoadCancellable) return;
        this.albumArtLoadGeneration++;
        this.albumArtLoadCancellable.cancel();
        this.albumArtLoadCancellable = null;
        this.loadingAlbumArtKey = null;
    }

    remove() {
        this.cancelAlbumArtLoad();
        this.loadedAlbumArtKey = null;
        if (!this.albumArtFrame) return;

        this.albumArtFrame.get_parent()?.remove_child(this.albumArtFrame);
        this.albumArtFrame.destroy();
        this.albumArtFrame = null;
        this.albumArtImage = null;
    }

    async render() {
        const metadata = this.mediaApp.metadata;
        const width = this.getAlbumArtWidth();
        const configuredRadius = Number.isFinite(this.extensionController.popupAlbumArtCornerRadius)
            ? this.extensionController.popupAlbumArtCornerRadius
            : POPUP_ALBUM_ART_CORNER_RADIUS.DEFAULT;
        const radius = Math.min(configuredRadius, Math.round(width / 2));
        const albumArtKey = [
            this.mediaApp.busName,
            metadata["mpris:artUrl"] ?? "",
            metadata["xesam:url"] ?? "",
            width,
            radius,
            this.extensionController.cacheAlbumArt,
        ].join("\u0000");

        this.ensureAlbumArtActor(width, radius);
        this.attach();
        if (this.loadedAlbumArtKey === albumArtKey || this.loadingAlbumArtKey === albumArtKey) return;

        this.cancelAlbumArtLoad();
        const loadGeneration = ++this.albumArtLoadGeneration;
        const loadCancellable = new Gio.Cancellable();
        this.albumArtLoadCancellable = loadCancellable;
        this.loadingAlbumArtKey = albumArtKey;

        try {
            const { albumArtSource, fallbackIcon } = await this.resolveAlbumArtSource(metadata, loadCancellable);
            if (!this.isCurrentAlbumArtLoad(loadGeneration, loadCancellable, albumArtKey)) {
                this.closeInputStream(albumArtSource?.stream);
                return;
            }

            const pixbuf = await this.decodeAlbumArtSource(albumArtSource, width, loadCancellable);
            if (!this.isCurrentAlbumArtLoad(loadGeneration, loadCancellable, albumArtKey)) return;

            if (pixbuf) this.setAlbumArtPixbuf(width, radius, pixbuf);
            else {
                this.setAlbumArtFallback(width, radius, fallbackIcon);
                logger.debugOnce(
                    `fallback:${this.mediaApp.busName}`,
                    "Using album-art fallback for",
                    this.mediaApp.busName,
                );
            }
        } catch (error) {
            if (
                !isCancellationError(error) &&
                this.isCurrentAlbumArtLoad(loadGeneration, loadCancellable, albumArtKey)
            ) {
                logger.warnOnce(
                    `processing:${this.mediaApp.busName}`,
                    "Album-art processing failed; using the fallback icon",
                    error,
                );
                this.setAlbumArtFallback(width, radius, null);
            }
        } finally {
            if (this.isCurrentAlbumArtLoad(loadGeneration, loadCancellable, albumArtKey)) {
                // Remember fallback results too, otherwise every metadata update
                // would retry the same unavailable URL and hurt popup latency.
                this.loadedAlbumArtKey = albumArtKey;
                this.loadingAlbumArtKey = null;
                this.albumArtLoadCancellable = null;
            }
        }
    }

    async resolveAlbumArtSource(metadata, loadCancellable) {
        let fallbackIcon = null;
        let albumArtSource = await this.tryLoadAlbumArt(metadata["mpris:artUrl"], loadCancellable, "MPRIS album art");
        if (albumArtSource || !metadata["xesam:url"]) return { albumArtSource, fallbackIcon };

        let trackUri;
        try {
            trackUri = GLib.Uri.parse(metadata["xesam:url"], GLib.UriFlags.NONE);
        } catch (error) {
            logger.debugOnce(`track-uri:${this.mediaApp.busName}`, "Ignoring an invalid local track URI", error);
            return { albumArtSource: null, fallbackIcon };
        }

        if (trackUri.get_scheme() !== "file") return { albumArtSource: null, fallbackIcon };

        const file = Gio.File.new_for_uri(trackUri.to_string());
        let info;
        try {
            info = await file.query_info_async(
                `${Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH},${Gio.FILE_ATTRIBUTE_STANDARD_ICON}`,
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                loadCancellable,
            );
        } catch (error) {
            if (isCancellationError(error)) throw error;
            logger.debugOnce(
                `track-metadata:${this.mediaApp.busName}`,
                "Local track metadata did not provide album art",
                error,
            );
            return { albumArtSource: null, fallbackIcon };
        }

        fallbackIcon = info.get_icon();
        const thumbnailPath = info.get_attribute_byte_string(Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH);
        if (thumbnailPath)
            albumArtSource = await this.tryLoadAlbumArt(
                Gio.File.new_for_path(thumbnailPath).get_uri(),
                loadCancellable,
                "thumbnail",
            );

        return { albumArtSource, fallbackIcon };
    }

    async tryLoadAlbumArt(albumArtUri, loadCancellable, sourceName) {
        if (!albumArtUri) return null;

        logger.debug("Loading album art", albumArtUri.slice(0, 60));

        try {
            return await this.albumArtLoader.loadAlbumArt(albumArtUri, this.extensionController.cacheAlbumArt, loadCancellable);
        } catch (error) {
            if (isCancellationError(error)) throw error;
            logger.debugOnce(
                `source-load:${this.mediaApp.busName}:${sourceName}`,
                `Failed to load ${sourceName}; trying the next fallback`,
                error,
            );
            return null;
        }
    }

    async decodeAlbumArtSource(albumArtSource, width, loadCancellable) {
        if (!albumArtSource) return null;

        try {
            return await this.decodeAlbumArtStream(albumArtSource.stream, width, loadCancellable);
        } catch (error) {
            if (isCancellationError(error) || !albumArtSource.loadedFromCache) throw error;

            // A partial or corrupt cached response must not become a permanent
            // fallback. Remove it and retry the same request once from its
            // original source; the successful response is cached again.
            logger.debugOnce(
                `invalid-cache:${albumArtSource.albumArtUri}`,
                "Discarding an invalid album-art cache entry",
                albumArtSource.albumArtUri,
                error,
            );
            await this.albumArtLoader.removeCachedAlbumArt(albumArtSource.albumArtUri, loadCancellable);
            const refreshedSource = await this.albumArtLoader.loadAlbumArt(
                albumArtSource.albumArtUri,
                this.extensionController.cacheAlbumArt,
                loadCancellable,
                { bypassCacheRead: true },
            );
            return this.decodeAlbumArtStream(refreshedSource?.stream ?? null, width, loadCancellable);
        }
    }

    async decodeAlbumArtStream(stream, width, loadCancellable) {
        if (!stream) return null;

        try {
            const decodeSize = Math.max(1, Math.round(width * 2));
            return await GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                stream,
                decodeSize,
                decodeSize,
                true,
                loadCancellable,
            );
        } finally {
            this.closeInputStream(stream);
        }
    }

    setAlbumArtPixbuf(width, radius, pixbuf) {
        const imageSize = this.getImageSize(width);
        const imageRadius = this.getImageRadius(radius);
        const squarePixbuf = this.cropPixbufToSquare(pixbuf, imageSize);
        const renderPixbuf =
            imageRadius > 0 ? this.roundAlbumArtPixbufCorners(squarePixbuf, imageRadius) : squarePixbuf;

        this.albumArtImage.content = null;
        this.albumArtImage.remove_style_class_name("button");
        this.albumArtImage.remove_style_class_name("mediashell-popup-album-art-fallback");
        setGIcon(this.albumArtImage, renderPixbuf, IconNames.MEDIA);
        this.albumArtImage.set_icon_size(imageSize);
    }

    ensureAlbumArtActor(width, radius) {
        if (this.albumArtFrame) {
            this.syncAlbumArtGeometry(width, radius);
            return;
        }

        this.albumArtImage = createIcon(
            {
                styleClass: "mediashell-popup-album-art",
                xExpand: false,
                yExpand: false,
                xAlign: Clutter.ActorAlign.CENTER,
                yAlign: Clutter.ActorAlign.CENTER,
            },
            IconNames.MEDIA,
        );
        this.albumArtFrame = new St.Bin({
            styleClass: "mediashell-popup-album-art-frame",
            xExpand: false,
            yExpand: false,
            xAlign: Clutter.ActorAlign.CENTER,
            yAlign: Clutter.ActorAlign.CENTER,
        });
        this.albumArtFrame.set_child(this.albumArtImage);
        this.setAlbumArtFallback(width, radius, null);
    }

    getImageSize(width) {
        return Math.max(1, Math.round(width - ALBUM_ART_OUTLINE_WIDTH * 2));
    }

    getImageRadius(radius) {
        return Math.max(0, radius - ALBUM_ART_OUTLINE_WIDTH);
    }

    syncAlbumArtGeometry(width, radius) {
        const imageSize = this.getImageSize(width);
        const imageRadius = this.getImageRadius(radius);

        this.albumArtFrame.style = `border-radius: ${radius}px; padding: ${ALBUM_ART_OUTLINE_WIDTH}px;`;
        this.albumArtFrame.width = width;
        this.albumArtFrame.height = width;
        this.albumArtImage.style = `border-radius: ${imageRadius}px;`;
        this.albumArtImage.width = imageSize;
        this.albumArtImage.height = imageSize;
    }

    setAlbumArtFallback(width, radius, icon) {
        logger.debug("Album art unavailable, using fallback icon", this.mediaApp?.busName);
        const imageSize = this.getImageSize(width);
        this.syncAlbumArtGeometry(width, radius);
        this.albumArtImage.content = null;
        // Reuse the Shell's native button surface so the empty album-art fallback follows
        // the active light/dark theme instead of relying on a fixed gray.
        this.albumArtImage.add_style_class_name("button");
        this.albumArtImage.add_style_class_name("mediashell-popup-album-art-fallback");
        setGIcon(this.albumArtImage, icon ?? this.fallbackAlbumArtIcon, IconNames.MEDIA);
        this.albumArtImage.set_icon_size(Math.max(56, Math.round(imageSize * 0.48)));
    }

    attach() {
        if (this.albumArtFrame.get_parent()) return;
        if (this.appSelectorActor?.get_parent() === this.popupItem)
            this.popupItem.insert_child_above(this.albumArtFrame, this.appSelectorActor);
        else this.popupItem.add_child(this.albumArtFrame);
    }

    isCurrentAlbumArtLoad(loadGeneration, loadCancellable, albumArtKey) {
        return (
            loadGeneration === this.albumArtLoadGeneration &&
            !loadCancellable.is_cancelled() &&
            this.loadingAlbumArtKey === albumArtKey
        );
    }

    closeInputStream(stream) {
        if (!stream) return;

        try {
            stream.close(null);
        } catch (error) {
            // Cancellation and GdkPixbuf may close the stream before teardown.
            logger.debugOnce("stream-close", "Album-art stream was already closed", error);
        }
    }

    cropPixbufToSquare(pixbuf, size) {
        const targetSize = Math.max(1, Math.round(size));
        const sourceWidth = pixbuf.get_width();
        const sourceHeight = pixbuf.get_height();
        if (sourceWidth <= 0 || sourceHeight <= 0) return pixbuf;

        // Scale like CSS `cover`: the shortest side fills the square and the
        // excess on the longest side is cropped equally around the center.
        const scale = Math.max(targetSize / sourceWidth, targetSize / sourceHeight);
        const scaledWidth = Math.max(targetSize, Math.round(sourceWidth * scale));
        const scaledHeight = Math.max(targetSize, Math.round(sourceHeight * scale));
        const scaled = pixbuf.scale_simple(scaledWidth, scaledHeight, GdkPixbuf.InterpType.BILINEAR);
        if (!scaled) return pixbuf;

        const cropX = Math.max(0, Math.floor((scaledWidth - targetSize) / 2));
        const cropY = Math.max(0, Math.floor((scaledHeight - targetSize) / 2));
        return scaled.new_subpixbuf(cropX, cropY, targetSize, targetSize).copy();
    }

    roundAlbumArtPixbufCorners(pixbuf, radius) {
        let source = pixbuf;
        if (!source.get_has_alpha()) source = source.add_alpha(false, 0, 0, 0);

        const width = source.get_width();
        const height = source.get_height();
        const cornerRadius = Math.min(Math.floor(radius), Math.floor(Math.min(width, height) / 2));
        if (cornerRadius <= 0) return source;

        const rowstride = source.get_rowstride();
        const channels = source.get_n_channels();
        const pixels = new Uint8Array(source.get_pixels());
        const samples = [0.125, 0.375, 0.625, 0.875];
        const sampleCount = samples.length * samples.length;
        const radiusSquared = cornerRadius * cornerRadius;

        // Only the four corner squares are touched; the center remains a fast
        // direct copy even for large album-art settings.
        for (let y = 0; y < cornerRadius; y++) {
            this.roundAlbumArtCornerRow(
                pixels,
                rowstride,
                channels,
                y,
                cornerRadius,
                width,
                cornerRadius,
                radiusSquared,
                samples,
                sampleCount,
            );
            this.roundAlbumArtCornerRow(
                pixels,
                rowstride,
                channels,
                height - 1 - y,
                height - cornerRadius,
                width,
                cornerRadius,
                radiusSquared,
                samples,
                sampleCount,
            );
        }

        return GdkPixbuf.Pixbuf.new_from_bytes(
            GLib.Bytes.new(pixels),
            source.get_colorspace(),
            source.get_has_alpha(),
            source.get_bits_per_sample(),
            width,
            height,
            rowstride,
        );
    }

    roundAlbumArtCornerRow(
        pixels,
        rowstride,
        channels,
        y,
        centerY,
        width,
        radius,
        radiusSquared,
        samples,
        sampleCount,
    ) {
        for (let xOffset = 0; xOffset < radius; xOffset++) {
            for (const x of [xOffset, width - 1 - xOffset]) {
                const centerX = x < radius ? radius : width - radius;
                let inside = 0;
                for (const sampleY of samples) {
                    const deltaY = y + sampleY - centerY;
                    const deltaYSquared = deltaY * deltaY;
                    for (const sampleX of samples) {
                        const deltaX = x + sampleX - centerX;
                        if (deltaX * deltaX + deltaYSquared <= radiusSquared) inside++;
                    }
                }
                if (inside === sampleCount) continue;
                const offset = y * rowstride + x * channels + 3;
                pixels[offset] = Math.round((pixels[offset] * inside) / sampleCount);
            }
        }
    }

    destroy() {
        this.remove();
        this.albumArtLoader = null;
        this.fallbackAlbumArtIcon = null;
        this.popupContent = null;
    }
}
