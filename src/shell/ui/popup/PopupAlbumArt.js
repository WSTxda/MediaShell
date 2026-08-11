/**
 * @file PopupAlbumArt.js
 * @module shell.ui.popup.PopupAlbumArt
 *
 * Owns popup album-art actors, playback-state animation, request generations,
 * cancellation, and visible fallback state. Shared source, decode, pixbuf, and
 * presentation helpers keep artwork behavior aligned with the top bar.
 */

import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import St from "gi://St";

import { IconNames } from "../../../shared/constants/icons.js";
import { PlaybackStatus } from "../../../shared/enums/playback.js";
import {
  calculateAlbumArtCornerRadius,
  createAlbumArtRequest,
} from "../../../shared/utils/albumArt.js";
import { createLogger } from "../../../shared/utils/log.js";
import {
  POPUP_ALBUM_ART_PAUSED_SCALE,
  POPUP_ALBUM_ART_PLAYBACK_ANIMATION_DURATION_MS,
} from "../../constants/popup.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import AlbumArtLoader from "../../services/AlbumArtLoader.js";
import {
  closeAlbumArtSource,
  decodeAlbumArtSource,
} from "../../utils/albumArtDecode.js";
import { prepareAlbumArtPixbuf } from "../../utils/albumArtPixbuf.js";
import {
  getAlbumArtFallbackIconSize,
  setAlbumArtFallbackPresentation,
  setAlbumArtImagePresentation,
  syncAlbumArtGeometry,
} from "../../utils/albumArtPresentation.js";
import { isCancellationError } from "../../utils/errors.js";
import { createIcon, setGIcon } from "../../utils/icons.js";
import { resolveAlbumArtSource } from "../../utils/albumArtSource.js";

const logger = createLogger("PopupAlbumArt");

/** Owns album-art rendering and lifecycle for the popup surface. */
export default class PopupAlbumArt {
  constructor(popupContent) {
    this.popupContent = popupContent;
    this.albumArtFrame = null;
    this.albumArtImage = null;
    this.albumArtLoadGeneration = 0;
    this.albumArtLoadCancellable = null;
    this.loadedAlbumArtSourceKey = null;
    this.loadingAlbumArtSourceKey = null;
    this.loadedAlbumArtPixbuf = null;
    this.loadedAlbumArtFallbackIcon = null;
    this.playbackScaleTarget = null;
    this.albumArtLoader = AlbumArtLoader.getInstance();
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

  getCurrentGeometry() {
    const width = this.getAlbumArtWidth();
    return {
      width,
      radius: calculateAlbumArtCornerRadius(
        width,
        this.extensionController.popupAlbumArtCornerRadius,
      ),
    };
  }

  createCurrentRequest() {
    const { width, radius } = this.getCurrentGeometry();
    return createAlbumArtRequest({
      busName: this.mediaApp.busName,
      metadata: this.mediaApp.metadata,
      width,
      radius,
      cacheEnabled: this.extensionController.albumArtCacheEnabled,
    });
  }

  async render() {
    const request = this.createCurrentRequest();
    this.ensureAlbumArtActor(request.width, request.radius);
    this.attach();
    this.syncPlaybackState(this.mediaApp.playbackStatus, false);

    if (this.loadedAlbumArtSourceKey === request.sourceKey) {
      this.syncLoadedPresentation(request.width, request.radius);
      return;
    }
    if (this.loadingAlbumArtSourceKey === request.sourceKey) {
      this.syncAlbumArtGeometry(request.width, request.radius);
      return;
    }

    this.cancelAlbumArtLoad();
    this.clearLoadedAlbumArt();
    this.setAlbumArtFallback(request.width, request.radius, null);

    const loadGeneration = ++this.albumArtLoadGeneration;
    const loadCancellable = new Gio.Cancellable();
    this.albumArtLoadCancellable = loadCancellable;
    this.loadingAlbumArtSourceKey = request.sourceKey;

    try {
      const { albumArtSource, fallbackIcon } = await resolveAlbumArtSource({
        albumArtLoader: this.albumArtLoader,
        ...request,
        loadCancellable,
      });
      if (
        !this.isCurrentAlbumArtLoad(loadGeneration, loadCancellable, request)
      ) {
        closeAlbumArtSource(albumArtSource);
        return;
      }

      const pixbuf = await decodeAlbumArtSource({
        albumArtLoader: this.albumArtLoader,
        albumArtSource,
        size: request.width,
        loadCancellable,
      });
      if (!this.isCurrentAlbumArtLoad(loadGeneration, loadCancellable, request))
        return;

      this.setLoadedAlbumArt(request.sourceKey, pixbuf, fallbackIcon);
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
        this.setLoadedAlbumArt(request.sourceKey, null, null);
      }
    } finally {
      if (
        this.isCurrentAlbumArtLoad(loadGeneration, loadCancellable, request)
      ) {
        this.loadingAlbumArtSourceKey = null;
        this.albumArtLoadCancellable = null;
      }
    }
  }

  setLoadedAlbumArt(sourceKey, pixbuf, fallbackIcon) {
    this.loadedAlbumArtSourceKey = sourceKey;
    this.loadedAlbumArtPixbuf = pixbuf;
    this.loadedAlbumArtFallbackIcon = fallbackIcon;
    const { width, radius } = this.getCurrentGeometry();
    this.syncLoadedPresentation(width, radius);
  }

  clearLoadedAlbumArt() {
    this.loadedAlbumArtSourceKey = null;
    this.loadedAlbumArtPixbuf = null;
    this.loadedAlbumArtFallbackIcon = null;
  }

  syncLoadedPresentation(width, radius) {
    if (this.loadedAlbumArtPixbuf)
      this.setAlbumArtPixbuf(width, radius, this.loadedAlbumArtPixbuf);
    else
      this.setAlbumArtFallback(width, radius, this.loadedAlbumArtFallbackIcon);
  }

  setAlbumArtPixbuf(width, radius, pixbuf) {
    const { imageSize, imageRadius } = this.syncAlbumArtGeometry(width, radius);
    const renderPixbuf = prepareAlbumArtPixbuf(pixbuf, imageSize, imageRadius);

    setAlbumArtImagePresentation(this.albumArtImage);
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

  syncAlbumArtGeometry(width, radius) {
    return syncAlbumArtGeometry(
      this.albumArtFrame,
      this.albumArtImage,
      width,
      radius,
    );
  }

  setAlbumArtFallback(width, radius, icon) {
    const { imageSize } = this.syncAlbumArtGeometry(width, radius);
    setAlbumArtFallbackPresentation(this.albumArtImage);
    setGIcon(this.albumArtImage, icon, IconNames.MEDIA);
    this.albumArtImage.set_icon_size(getAlbumArtFallbackIconSize(imageSize));
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

  cancelAlbumArtLoad() {
    if (!this.albumArtLoadCancellable) return;
    this.albumArtLoadGeneration++;
    this.albumArtLoadCancellable.cancel();
    this.albumArtLoadCancellable = null;
    this.loadingAlbumArtSourceKey = null;
  }

  isCurrentAlbumArtLoad(loadGeneration, loadCancellable, request) {
    return (
      this.albumArtFrame &&
      loadGeneration === this.albumArtLoadGeneration &&
      !loadCancellable.is_cancelled() &&
      this.loadingAlbumArtSourceKey === request.sourceKey &&
      this.mediaApp?.busName === request.busName
    );
  }

  remove() {
    this.cancelAlbumArtLoad();
    this.clearLoadedAlbumArt();
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
    this.popupContent = null;
  }
}
