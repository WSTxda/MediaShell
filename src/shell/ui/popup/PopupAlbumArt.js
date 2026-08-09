/**
 * @file PopupAlbumArt.js
 * @module shell.ui.popup.PopupAlbumArt
 *
 * Owns popup album-art loading, playback-state animation, safe fallbacks, decoded-image transform coordination, and actor lifecycle.
 *
 * PopupContent delegates album art to this component so async file/network loads
 * are isolated from the rest of the popup. The component cancels stale loads by
 * generation, delegates stateless pixbuf transforms, and falls back to a themed icon.
 */

import Clutter from "gi://Clutter";
import GdkPixbuf from "gi://GdkPixbuf";
import Gio from "gi://Gio";
import St from "gi://St";

import { createAlbumArtRequest } from "../../../shared/utils/albumArt.js";
import { IconNames } from "../../../shared/constants/icons.js";
import { POPUP_ALBUM_ART_CORNER_RADIUS_CONSTRAINTS } from "../../../shared/constants/settings.js";
import { PlaybackStatus } from "../../../shared/enums/playback.js";
import { createLogger } from "../../../shared/utils/log.js";
import {
  POPUP_ALBUM_ART_OUTLINE_WIDTH,
  POPUP_ALBUM_ART_PAUSED_SCALE,
  POPUP_ALBUM_ART_PLAYBACK_ANIMATION_DURATION_MS,
} from "../../constants/popup.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import AlbumArtLoader from "../../services/AlbumArtLoader.js";
import {
  cropPixbufToSquare,
  roundPixbufCorners,
} from "../../utils/albumArtPixbuf.js";
import { isCancellationError } from "../../utils/errors.js";
import { createIcon, setGIcon } from "../../utils/icons.js";
import { resolveAlbumArtSource } from "../../utils/albumArtSource.js";

if (typeof GdkPixbuf?.Pixbuf?.new_from_stream_at_scale_async === "function") {
  Gio._promisify(
    GdkPixbuf.Pixbuf,
    "new_from_stream_at_scale_async",
    "new_from_stream_finish",
  );
}

Gio._promisify(Gio.File.prototype, "query_info_async", "query_info_finish");

const logger = createLogger("PopupAlbumArt");

/**
 * Owns popup album-art loading, playback-state animation, safe fallbacks, decoded-image transform coordination, and actor lifecycle.
 */
export default class PopupAlbumArt {
  constructor(popupContent) {
    this.popupContent = popupContent;
    this.albumArtLoadGeneration = 0;
    this.albumArtLoadCancellable = null;
    this.loadedAlbumArtKey = null;
    this.loadingAlbumArtKey = null;
    this.playbackScaleTarget = null;
    this.albumArtLoader = AlbumArtLoader.getInstance();
    this.fallbackAlbumArtIcon = Gio.ThemedIcon.new_from_names([
      IconNames.MEDIA,
      IconNames.MISSING,
    ]);
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
  get mediaAppSelectorActor() {
    return this.popupContent.mediaAppSelectorController.actor;
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

  async render() {
    const metadata = this.mediaApp.metadata;
    const width = this.getAlbumArtWidth();
    const configuredRadius = Number.isFinite(
      this.extensionController.popupAlbumArtCornerRadius,
    )
      ? this.extensionController.popupAlbumArtCornerRadius
      : POPUP_ALBUM_ART_CORNER_RADIUS_CONSTRAINTS.DEFAULT;
    const radius = Math.min(configuredRadius, Math.round(width / 2));
    const request = createAlbumArtRequest({
      busName: this.mediaApp.busName,
      metadata,
      width,
      radius,
      cacheEnabled: this.extensionController.albumArtCacheEnabled,
    });

    this.ensureAlbumArtActor(request.width, request.radius);
    this.attach();
    this.syncPlaybackState(this.mediaApp.playbackStatus, false);
    if (
      this.loadedAlbumArtKey === request.key ||
      this.loadingAlbumArtKey === request.key
    )
      return;

    this.cancelAlbumArtLoad();
    const loadGeneration = ++this.albumArtLoadGeneration;
    const loadCancellable = new Gio.Cancellable();
    this.albumArtLoadCancellable = loadCancellable;
    this.loadingAlbumArtKey = request.key;

    try {
      const { albumArtSource, fallbackIcon } = await resolveAlbumArtSource({
        albumArtLoader: this.albumArtLoader,
        ...request,
        loadCancellable,
      });
      if (
        !this.isCurrentAlbumArtLoad(loadGeneration, loadCancellable, request)
      ) {
        this.closeInputStream(albumArtSource?.stream);
        return;
      }

      const pixbuf = await this.decodeAlbumArtSource(
        albumArtSource,
        request.width,
        loadCancellable,
      );
      if (!this.isCurrentAlbumArtLoad(loadGeneration, loadCancellable, request))
        return;

      if (pixbuf) this.setAlbumArtPixbuf(request.width, request.radius, pixbuf);
      else {
        this.setAlbumArtFallback(request.width, request.radius, fallbackIcon);
      }
    } catch (error) {
      if (
        !isCancellationError(error) &&
        this.isCurrentAlbumArtLoad(loadGeneration, loadCancellable, request)
      ) {
        logger.warnOnce(
          `processing:${request.busName}`,
          "Album-art processing failed; using the fallback icon",
          error,
        );
        this.setAlbumArtFallback(request.width, request.radius, null);
      }
    } finally {
      if (
        this.isCurrentAlbumArtLoad(loadGeneration, loadCancellable, request)
      ) {
        // Remember fallback results too, otherwise every metadata update
        // would retry the same unavailable URL and hurt popup latency.
        this.loadedAlbumArtKey = request.key;
        this.loadingAlbumArtKey = null;
        this.albumArtLoadCancellable = null;
      }
    }
  }

  async decodeAlbumArtSource(albumArtSource, width, loadCancellable) {
    if (!albumArtSource) return null;

    try {
      return await this.decodeAlbumArtStream(
        albumArtSource.stream,
        width,
        loadCancellable,
      );
    } catch (error) {
      if (isCancellationError(error) || !albumArtSource.loadedFromCache)
        throw error;

      // A partial or corrupt cached response must not become a permanent
      // fallback. Remove it and retry the same request once from its
      // original source; the successful response is cached again.
      logger.debugOnce(
        `invalid-cache:${albumArtSource.albumArtUri}`,
        "Discarding an invalid album-art cache entry",
        albumArtSource.albumArtUri,
        error,
      );
      await this.albumArtLoader.removeCachedAlbumArt(
        albumArtSource.albumArtUri,
        loadCancellable,
      );
      const refreshedSource = await this.albumArtLoader.loadAlbumArt(
        albumArtSource.albumArtUri,
        albumArtSource.cacheEnabled,
        loadCancellable,
        { bypassCacheRead: true },
      );
      return this.decodeAlbumArtStream(
        refreshedSource?.stream ?? null,
        width,
        loadCancellable,
      );
    }
  }

  async decodeAlbumArtStream(stream, width, loadCancellable) {
    if (!stream) return null;

    if (
      typeof GdkPixbuf?.Pixbuf?.new_from_stream_at_scale_async !== "function"
    ) {
      this.closeInputStream(stream);
      return null;
    }

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
    const orientedPixbuf = pixbuf.apply_embedded_orientation?.() ?? pixbuf;
    const squarePixbuf = cropPixbufToSquare(orientedPixbuf, imageSize);
    const renderPixbuf =
      imageRadius > 0
        ? roundPixbufCorners(squarePixbuf, imageRadius)
        : squarePixbuf;

    this.albumArtImage.content = null;
    this.albumArtImage.remove_style_class_name(StyleClasses.BUTTON);
    this.albumArtImage.remove_style_class_name(
      StyleClasses.POPUP_ALBUM_ART_FALLBACK,
    );
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
        styleClass: StyleClasses.POPUP_ALBUM_ART,
        xExpand: false,
        yExpand: false,
        xAlign: Clutter.ActorAlign.CENTER,
        yAlign: Clutter.ActorAlign.CENTER,
      },
      IconNames.MEDIA,
    );
    this.albumArtFrame = new St.Bin({
      styleClass: StyleClasses.POPUP_ALBUM_ART_FRAME,
      xExpand: false,
      yExpand: false,
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.albumArtFrame.set_pivot_point(0.5, 0.5);
    this.albumArtFrame.set_child(this.albumArtImage);
    this.setAlbumArtFallback(width, radius, null);
  }

  syncPlaybackState(playbackStatus, animate = true) {
    if (!this.albumArtFrame) return;

    const targetScale =
      playbackStatus === PlaybackStatus.PLAYING
        ? 1
        : POPUP_ALBUM_ART_PAUSED_SCALE;
    if (targetScale === this.playbackScaleTarget) return;

    this.playbackScaleTarget = targetScale;
    if (!animate) {
      this.stopPlaybackScaleTransition();
      this.albumArtFrame.set_scale(targetScale, targetScale);
      return;
    }

    this.albumArtFrame.ease({
      scale_x: targetScale,
      scale_y: targetScale,
      duration: POPUP_ALBUM_ART_PLAYBACK_ANIMATION_DURATION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
  }

  stopPlaybackScaleTransition() {
    this.albumArtFrame?.remove_transition("scale-x");
    this.albumArtFrame?.remove_transition("scale-y");
  }

  getImageSize(width) {
    return Math.max(1, Math.round(width - POPUP_ALBUM_ART_OUTLINE_WIDTH * 2));
  }

  getImageRadius(radius) {
    return Math.max(0, radius - POPUP_ALBUM_ART_OUTLINE_WIDTH);
  }

  syncAlbumArtGeometry(width, radius) {
    const imageSize = this.getImageSize(width);
    const imageRadius = this.getImageRadius(radius);

    this.albumArtFrame.style = `border-radius: ${radius}px; padding: ${POPUP_ALBUM_ART_OUTLINE_WIDTH}px;`;
    this.albumArtFrame.width = width;
    this.albumArtFrame.height = width;
    this.albumArtImage.style = `border-radius: ${imageRadius}px;`;
    this.albumArtImage.width = imageSize;
    this.albumArtImage.height = imageSize;
  }

  setAlbumArtFallback(width, radius, icon) {
    const imageSize = this.getImageSize(width);
    this.syncAlbumArtGeometry(width, radius);
    this.albumArtImage.content = null;
    // Reuse the Shell's native button surface so the empty album-art fallback follows
    // the active light/dark theme instead of relying on a fixed gray.
    this.albumArtImage.add_style_class_name(StyleClasses.BUTTON);
    this.albumArtImage.add_style_class_name(
      StyleClasses.POPUP_ALBUM_ART_FALLBACK,
    );
    setGIcon(
      this.albumArtImage,
      icon ?? this.fallbackAlbumArtIcon,
      IconNames.MEDIA,
    );
    this.albumArtImage.set_icon_size(
      Math.max(56, Math.round(imageSize * 0.48)),
    );
  }

  attach() {
    if (this.albumArtFrame.get_parent()) return;
    if (this.mediaAppSelectorActor?.get_parent() === this.popupItem)
      this.popupItem.insert_child_above(
        this.albumArtFrame,
        this.mediaAppSelectorActor,
      );
    else this.popupItem.add_child(this.albumArtFrame);
  }

  remove() {
    this.cancelAlbumArtLoad();
    this.loadedAlbumArtKey = null;
    this.playbackScaleTarget = null;
    if (!this.albumArtFrame) return;

    this.stopPlaybackScaleTransition();
    this.albumArtFrame.get_parent()?.remove_child(this.albumArtFrame);
    this.albumArtFrame.destroy();
    this.albumArtFrame = null;
    this.albumArtImage = null;
  }

  isCurrentAlbumArtLoad(loadGeneration, loadCancellable, request) {
    return (
      loadGeneration === this.albumArtLoadGeneration &&
      !loadCancellable.is_cancelled() &&
      this.loadingAlbumArtKey === request.key &&
      this.mediaApp?.busName === request.busName
    );
  }

  closeInputStream(stream) {
    if (!stream) return;

    try {
      stream.close(null);
    } catch {
      // Cancellation and GdkPixbuf may close the stream before teardown.
    }
  }

  destroy() {
    this.remove();
    this.albumArtLoader = null;
    this.fallbackAlbumArtIcon = null;
    this.popupContent = null;
  }
}
