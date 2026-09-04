/**
 * @file popupAlbumArt.js
 * @module shell.ui.popup.popupAlbumArt
 *
 * Owns popup album-art presentation, request lifecycle, and playback animation.
 */

import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import St from "gi://St";

import { IconNames } from "../../../shared/icons.js";
import { POPUP_ALBUM_ART_CORNER_RADIUS_CONSTRAINTS } from "../../../shared/settings/contract.js";
import { PlaybackStatus } from "../../mpris/playbackState.js";
import {
  calculateAlbumArtCornerRadius,
  createAlbumArtRequest,
} from "../../media/artwork/policy.js";
import { createLogger } from "../../../shared/logging/logger.js";
import { ALBUM_ART_OUTLINE_WIDTH } from "../../constants/albumArt.js";
import {
  POPUP_ALBUM_ART_PAUSED_SCALE,
  POPUP_ALBUM_ART_PLAYBACK_ANIMATION_DURATION_MS,
} from "../../constants/popup.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import { loadAlbumArtResult } from "../../utils/albumArtLoading.js";
import { prepareAlbumArtPixbuf } from "../../utils/albumArtPixbuf.js";
import { getAlbumArtPresentationGeometry } from "../../utils/albumArtPresentation.js";
import { isCancellationError } from "../../utils/errors.js";
import { createIcon, setGIcon } from "../../utils/icons.js";

const logger = createLogger("PopupAlbumArt");

/** Owns popup album-art actors, async request state, and playback animation. */
export default class PopupAlbumArt {
  constructor(popupContent, albumArtLoader) {
    this.popupContent = popupContent;
    this.albumArtFrame = null;
    this.albumArtImage = null;
    this.albumArtLoadGeneration = 0;
    this.albumArtLoadCancellable = null;
    this.loadedAlbumArtKey = null;
    this.loadingAlbumArtKey = null;
    this.loadedAlbumArtPixbuf = null;
    this.preparedAlbumArt = null;
    this.loadedFallbackIcon = null;
    this.playbackScaleTarget = null;
    this.albumArtLoader = albumArtLoader;
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

  getAlbumArtGeometry() {
    const width = this.getAlbumArtWidth();
    const configuredRadius = Number.isFinite(
      this.extensionController.popupAlbumArtCornerRadius,
    )
      ? this.extensionController.popupAlbumArtCornerRadius
      : POPUP_ALBUM_ART_CORNER_RADIUS_CONSTRAINTS.DEFAULT;

    return {
      width,
      radius: calculateAlbumArtCornerRadius(width, configuredRadius),
    };
  }

  render() {
    const geometry = this.getAlbumArtGeometry();
    const request = createAlbumArtRequest({
      busName: this.mediaApp.busName,
      metadata: this.mediaApp.metadata,
      ...geometry,
      cacheEnabled: this.extensionController.albumArtCacheEnabled,
    });

    this.ensureActor();
    this.syncAlbumArtGeometry(geometry.width, geometry.radius);
    this.attach();
    this.syncPlaybackState(this.mediaApp.playbackStatus, false);

    if (this.loadedAlbumArtKey === request.key) {
      this.syncLoadedAlbumArt(geometry.width, geometry.radius);
      return;
    }
    if (this.loadingAlbumArtKey === request.key) {
      this.syncLoadedAlbumArt(geometry.width, geometry.radius);
      return;
    }

    this.cancelAlbumArtLoad();
    this.syncLoadedAlbumArt(geometry.width, geometry.radius);
    this.loadAlbumArt(request);
  }

  async loadAlbumArt(request) {
    const loadGeneration = ++this.albumArtLoadGeneration;
    const loadCancellable = new Gio.Cancellable();
    this.albumArtLoadCancellable = loadCancellable;
    this.loadingAlbumArtKey = request.key;

    try {
      const { pixbuf, fallbackIcon } = await loadAlbumArtResult({
        albumArtLoader: this.albumArtLoader,
        request,
        loadCancellable,
      });
      if (!this.isCurrentLoad(loadGeneration, loadCancellable, request)) return;

      this.commitAlbumArtResult(request, pixbuf, fallbackIcon);
    } catch (error) {
      if (
        !isCancellationError(error) &&
        this.isCurrentLoad(loadGeneration, loadCancellable, request)
      ) {
        logger.warnOnce(
          `processing:${request.busName}`,
          "Album-art processing failed; using the fallback icon",
          error,
        );
        this.commitAlbumArtResult(request, null, null);
      }
    } finally {
      if (this.isCurrentLoad(loadGeneration, loadCancellable, request)) {
        this.loadingAlbumArtKey = null;
        this.albumArtLoadCancellable = null;
      }
    }
  }

  commitAlbumArtResult(request, pixbuf, fallbackIcon) {
    this.loadedAlbumArtKey = request.key;
    this.loadedAlbumArtPixbuf = pixbuf ?? null;
    this.preparedAlbumArt = null;
    this.loadedFallbackIcon = pixbuf ? null : (fallbackIcon ?? null);
    const geometry = this.getAlbumArtGeometry();
    this.syncLoadedAlbumArt(geometry.width, geometry.radius);
  }

  syncLoadedAlbumArt(width, radius) {
    if (!this.albumArtFrame || !this.loadedAlbumArtKey) return;

    if (this.loadedAlbumArtPixbuf)
      this.setAlbumArtPixbuf(width, radius, this.loadedAlbumArtPixbuf);
    else this.setAlbumArtFallback(width, radius, this.loadedFallbackIcon);
  }

  setAlbumArtPixbuf(width, radius, pixbuf) {
    const { imageSize, imageRadius } = getAlbumArtPresentationGeometry(
      width,
      radius,
    );
    if (
      this.preparedAlbumArt?.key !== this.loadedAlbumArtKey ||
      this.preparedAlbumArt.imageSize !== imageSize ||
      this.preparedAlbumArt.imageRadius !== imageRadius
    ) {
      this.preparedAlbumArt = {
        key: this.loadedAlbumArtKey,
        imageSize,
        imageRadius,
        pixbuf: prepareAlbumArtPixbuf(pixbuf, imageSize, imageRadius),
      };
    }
    const renderPixbuf = this.preparedAlbumArt.pixbuf;

    this.albumArtImage.content = null;
    this.albumArtImage.remove_style_class_name(StyleClasses.BUTTON);
    this.albumArtImage.remove_style_class_name(StyleClasses.ALBUM_ART_FALLBACK);
    setGIcon(this.albumArtImage, renderPixbuf, IconNames.MEDIA);
    this.albumArtImage.set_icon_size(imageSize);
    this.albumArtFrame.opacity = 255;
  }

  ensureActor() {
    if (this.albumArtFrame) return;

    this.albumArtImage = createIcon(
      {
        styleClass: StyleClasses.ALBUM_ART_IMAGE,
        xExpand: false,
        yExpand: false,
        xAlign: Clutter.ActorAlign.CENTER,
        yAlign: Clutter.ActorAlign.CENTER,
      },
      IconNames.MEDIA,
    );
    this.albumArtFrame = new St.Bin({
      styleClass: StyleClasses.ALBUM_ART_FRAME,
      xExpand: false,
      yExpand: false,
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
      opacity: 0,
    });
    this.albumArtFrame.set_pivot_point(0.5, 0.5);
    this.albumArtFrame.set_child(this.albumArtImage);
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

  syncAlbumArtGeometry(width, radius) {
    const { frameSize, frameRadius, imageSize, imageRadius } =
      getAlbumArtPresentationGeometry(width, radius);

    this.albumArtFrame.style = `border-radius: ${frameRadius}px; padding: ${ALBUM_ART_OUTLINE_WIDTH}px;`;
    this.albumArtFrame.set_size(frameSize, frameSize);
    this.albumArtImage.style = `border-radius: ${imageRadius}px;`;
    this.albumArtImage.set_size(imageSize, imageSize);
  }

  setAlbumArtFallback(width, radius, icon) {
    const { imageSize, fallbackIconSize } = getAlbumArtPresentationGeometry(
      width,
      radius,
    );
    this.syncAlbumArtGeometry(width, radius);
    this.albumArtImage.content = null;
    this.albumArtImage.add_style_class_name(StyleClasses.BUTTON);
    this.albumArtImage.add_style_class_name(StyleClasses.ALBUM_ART_FALLBACK);
    setGIcon(
      this.albumArtImage,
      icon ?? this.fallbackAlbumArtIcon,
      IconNames.MEDIA,
    );
    this.albumArtImage.set_icon_size(fallbackIconSize);
    this.albumArtImage.set_size(imageSize, imageSize);
    this.albumArtFrame.opacity = 255;
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

  isCurrentLoad(loadGeneration, loadCancellable, request) {
    return (
      this.albumArtFrame &&
      loadGeneration === this.albumArtLoadGeneration &&
      !loadCancellable.is_cancelled() &&
      this.loadingAlbumArtKey === request.key &&
      this.mediaApp?.busName === request.busName
    );
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
    this.loadedAlbumArtPixbuf = null;
    this.preparedAlbumArt = null;
    this.loadedFallbackIcon = null;
    this.playbackScaleTarget = null;
    if (!this.albumArtFrame) return;

    this.stopPlaybackScaleTransition();
    this.albumArtFrame.get_parent()?.remove_child(this.albumArtFrame);
    this.albumArtFrame.destroy();
    this.albumArtFrame = null;
    this.albumArtImage = null;
  }

  destroy() {
    this.remove();
    this.albumArtLoader = null;
    this.fallbackAlbumArtIcon = null;
    this.popupContent = null;
  }
}
