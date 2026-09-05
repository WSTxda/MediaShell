/**
 * @file popupArtwork.js
 * @module shell.ui.popup.popupArtwork
 *
 * Owns popup artwork presentation, request lifecycle, and playback animation.
 */

import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import St from "gi://St";

import { MediaShellStyleClasses, NativeStyleClasses } from "../style.js";
import { IconNames } from "../../../shared/icons.js";
import { POPUP_ARTWORK_CORNER_RADIUS_PERCENT_CONSTRAINTS } from "../../../shared/settings/contract.js";
import { PlaybackStatus } from "../../mpris/protocol.js";
import { createArtworkRequest } from "../../media/artwork/request.js";
import {
  ARTWORK_OUTLINE_WIDTH,
  resolveArtworkCornerRadius,
  resolveArtworkPresentationGeometry,
  prepareArtworkPixbuf,
} from "../../media/artwork/presentation.js";
import { createLogger } from "../../../shared/logging/logger.js";
import {
  POPUP_ARTWORK_PAUSED_SCALE,
  POPUP_ARTWORK_PLAYBACK_ANIMATION_DURATION_MS,
} from "./presentation.js";
import { isCancellationError } from "../../platform/gioErrors.js";
import { createIcon, setGIcon } from "../icons.js";

const logger = createLogger("PopupArtwork");

/** Owns popup artwork actors, async request state, and playback animation. */
export default class PopupArtwork {
  constructor(popupSurface, artworkService) {
    this.popupSurface = popupSurface;
    this.artworkService = artworkService;
    this.fallbackArtworkIcon = Gio.ThemedIcon.new_from_names([
      IconNames.MEDIA,
      IconNames.MISSING,
    ]);
    this.artworkFrame = null;
    this.artworkImage = null;
    this.loadedArtworkKey = null;
    this.loadingArtworkKey = null;
    this.loadedArtworkPixbuf = null;
    this.preparedArtwork = null;
    this.loadedFallbackIcon = null;
    this.artworkLoadGeneration = 0;
    this.artworkLoadCancellable = null;
    this.playbackScaleTarget = null;
  }

  get settings() {
    return this.popupSurface.settings;
  }

  get player() {
    return this.popupSurface.player;
  }

  get popupItem() {
    return this.popupSurface.popupItem;
  }

  get playerSelectorActor() {
    return this.popupSurface.playerSelector.actor;
  }

  get actor() {
    return this.artworkFrame;
  }

  render() {
    const geometry = this.getArtworkGeometry();
    const request = createArtworkRequest({
      busName: this.player.busName,
      track: this.player.track,
      ...geometry,
    });

    this.ensureActor();
    this.syncArtworkGeometry(geometry.width, geometry.radius);
    this.attach();
    this.syncPlaybackState(this.player.playbackStatus, false);

    if (this.loadedArtworkKey === request.key) {
      this.syncLoadedArtwork(geometry.width, geometry.radius);
      return;
    }
    if (this.loadingArtworkKey === request.key) {
      this.syncLoadedArtwork(geometry.width, geometry.radius);
      return;
    }

    this.cancelArtworkLoad();
    this.syncLoadedArtwork(geometry.width, geometry.radius);
    this.loadArtwork(request);
  }

  getArtworkGeometry() {
    const width = this.getArtworkWidth();
    const cornerRadiusPercent = Number.isFinite(
      this.settings.artworkCornerRadiusPercent,
    )
      ? this.settings.artworkCornerRadiusPercent
      : POPUP_ARTWORK_CORNER_RADIUS_PERCENT_CONSTRAINTS.DEFAULT;

    return {
      width,
      radius: resolveArtworkCornerRadius(width, cornerRadiusPercent),
    };
  }

  getArtworkWidth() {
    return this.popupSurface.getArtworkWidth();
  }

  ensureActor() {
    if (this.artworkFrame) return;

    this.artworkImage = createIcon(
      {
        styleClass: MediaShellStyleClasses.ARTWORK_IMAGE,
        xExpand: false,
        yExpand: false,
        xAlign: Clutter.ActorAlign.CENTER,
        yAlign: Clutter.ActorAlign.CENTER,
      },
      IconNames.MEDIA,
    );
    this.artworkFrame = new St.Bin({
      styleClass: MediaShellStyleClasses.ARTWORK_FRAME,
      xExpand: false,
      yExpand: false,
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
      opacity: 0,
    });
    this.artworkFrame.set_pivot_point(0.5, 0.5);
    this.artworkFrame.set_child(this.artworkImage);
  }

  syncPlaybackState(playbackStatus, animate = true) {
    if (!this.artworkFrame) return;

    const targetScale =
      playbackStatus === PlaybackStatus.PLAYING
        ? 1
        : POPUP_ARTWORK_PAUSED_SCALE;
    if (targetScale === this.playbackScaleTarget) return;

    this.playbackScaleTarget = targetScale;
    if (!animate) {
      this.stopPlaybackScaleTransition();
      this.artworkFrame.set_scale(targetScale, targetScale);
      return;
    }

    this.artworkFrame.ease({
      scale_x: targetScale,
      scale_y: targetScale,
      duration: POPUP_ARTWORK_PLAYBACK_ANIMATION_DURATION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
  }

  stopPlaybackScaleTransition() {
    this.artworkFrame?.remove_transition("scale-x");
    this.artworkFrame?.remove_transition("scale-y");
  }

  syncArtworkGeometry(width, radius) {
    const { frameSize, frameRadius, imageSize, imageRadius } =
      resolveArtworkPresentationGeometry(width, radius);

    this.artworkFrame.style = `border-radius: ${frameRadius}px; padding: ${ARTWORK_OUTLINE_WIDTH}px;`;
    this.artworkFrame.set_size(frameSize, frameSize);
    this.artworkImage.style = `border-radius: ${imageRadius}px;`;
    this.artworkImage.set_size(imageSize, imageSize);
  }

  async loadArtwork(request) {
    const loadGeneration = ++this.artworkLoadGeneration;
    const loadCancellable = new Gio.Cancellable();
    this.artworkLoadCancellable = loadCancellable;
    this.loadingArtworkKey = request.key;

    try {
      const { pixbuf, fallbackIcon } = await this.artworkService.load(
        request,
        loadCancellable,
      );
      if (!this.isCurrentLoad(loadGeneration, loadCancellable, request)) return;

      this.commitArtworkResult(request, pixbuf, fallbackIcon);
    } catch (error) {
      if (
        !isCancellationError(error) &&
        this.isCurrentLoad(loadGeneration, loadCancellable, request)
      ) {
        logger.warnOnce(
          `processing:${request.busName}`,
          "Artwork processing failed; using the fallback icon",
          error,
        );
        this.commitArtworkResult(request, null, null);
      }
    } finally {
      if (this.isCurrentLoad(loadGeneration, loadCancellable, request)) {
        this.loadingArtworkKey = null;
        this.artworkLoadCancellable = null;
      }
    }
  }

  commitArtworkResult(request, pixbuf, fallbackIcon) {
    this.loadedArtworkKey = request.key;
    this.loadedArtworkPixbuf = pixbuf ?? null;
    this.preparedArtwork = null;
    this.loadedFallbackIcon = pixbuf ? null : (fallbackIcon ?? null);
    const geometry = this.getArtworkGeometry();
    this.syncLoadedArtwork(geometry.width, geometry.radius);
  }

  syncLoadedArtwork(width, radius) {
    if (!this.artworkFrame || !this.loadedArtworkKey) return;

    if (this.loadedArtworkPixbuf)
      this.setArtworkPixbuf(width, radius, this.loadedArtworkPixbuf);
    else this.setArtworkFallback(width, radius, this.loadedFallbackIcon);
  }

  setArtworkPixbuf(width, radius, pixbuf) {
    const { imageSize, imageRadius } = resolveArtworkPresentationGeometry(
      width,
      radius,
    );
    if (
      this.preparedArtwork?.key !== this.loadedArtworkKey ||
      this.preparedArtwork.imageSize !== imageSize ||
      this.preparedArtwork.imageRadius !== imageRadius
    ) {
      this.preparedArtwork = {
        key: this.loadedArtworkKey,
        imageSize,
        imageRadius,
        pixbuf: prepareArtworkPixbuf(pixbuf, imageSize, imageRadius),
      };
    }
    const renderPixbuf = this.preparedArtwork.pixbuf;

    this.artworkImage.content = null;
    this.artworkImage.remove_style_class_name(NativeStyleClasses.BUTTON);
    this.artworkImage.remove_style_class_name(
      MediaShellStyleClasses.ARTWORK_FALLBACK,
    );
    setGIcon(this.artworkImage, renderPixbuf, IconNames.MEDIA);
    this.artworkImage.set_icon_size(imageSize);
    this.artworkFrame.opacity = 255;
  }

  setArtworkFallback(width, radius, icon) {
    const { imageSize, fallbackIconSize } = resolveArtworkPresentationGeometry(
      width,
      radius,
    );
    this.syncArtworkGeometry(width, radius);
    this.artworkImage.content = null;
    this.artworkImage.add_style_class_name(NativeStyleClasses.BUTTON);
    this.artworkImage.add_style_class_name(
      MediaShellStyleClasses.ARTWORK_FALLBACK,
    );
    setGIcon(
      this.artworkImage,
      icon ?? this.fallbackArtworkIcon,
      IconNames.MEDIA,
    );
    this.artworkImage.set_icon_size(fallbackIconSize);
    this.artworkImage.set_size(imageSize, imageSize);
    this.artworkFrame.opacity = 255;
  }

  attach() {
    if (this.artworkFrame.get_parent()) return;
    if (this.playerSelectorActor?.get_parent() === this.popupItem)
      this.popupItem.insert_child_above(
        this.artworkFrame,
        this.playerSelectorActor,
      );
    else this.popupItem.add_child(this.artworkFrame);
  }

  isCurrentLoad(loadGeneration, loadCancellable, request) {
    return (
      this.artworkFrame &&
      loadGeneration === this.artworkLoadGeneration &&
      !loadCancellable.is_cancelled() &&
      this.loadingArtworkKey === request.key &&
      this.player?.busName === request.busName
    );
  }

  cancelArtworkLoad() {
    if (!this.artworkLoadCancellable) return;
    this.artworkLoadGeneration++;
    this.artworkLoadCancellable.cancel();
    this.artworkLoadCancellable = null;
    this.loadingArtworkKey = null;
  }

  remove() {
    this.cancelArtworkLoad();
    this.loadedArtworkKey = null;
    this.loadedArtworkPixbuf = null;
    this.preparedArtwork = null;
    this.loadedFallbackIcon = null;
    this.playbackScaleTarget = null;
    if (!this.artworkFrame) return;

    this.stopPlaybackScaleTransition();
    this.artworkFrame.get_parent()?.remove_child(this.artworkFrame);
    this.artworkFrame.destroy();
    this.artworkFrame = null;
    this.artworkImage = null;
  }

  destroy() {
    this.remove();
    this.artworkService = null;
    this.fallbackArtworkIcon = null;
    this.popupSurface = null;
  }
}
