/**
 * @file topBarAlbumArt.js
 * @module shell.ui.topbar.topBarAlbumArt
 *
 * Displays MPRIS album art as an independent top-bar metadata element.
 */

import { MediaShellStyleClasses, NativeStyleClasses, styleClassNames } from "../style.js";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { IconNames } from "../../../shared/icons.js";
import { TOP_BAR_ARTWORK_CORNER_RADIUS_CONSTRAINTS } from "../../../shared/settings/contract.js";
import { createArtworkRequest } from "../../media/artwork/request.js";
import {
  ARTWORK_OUTLINE_WIDTH,
  calculateArtworkCornerRadius,
  getArtworkPresentationGeometry,
  prepareArtworkPixbuf,
} from "../../media/artwork/presentation.js";
import { createLogger } from "../../../shared/logging/logger.js";
import { placeActorAtIndex } from "../components/actorOrder.js";
import { isCancellationError } from "../../platform/gioErrors.js";
import { createIcon, setGIcon } from "../icons.js";

const DEFAULT_PANEL_HEIGHT = 32;
const PANEL_HEIGHT_RATIO = 0.65;
const logger = createLogger("TopBarAlbumArt");

/** Displays configurable album art in the GNOME top bar. */
export default class TopBarAlbumArt {
  constructor(topBarContent, artworkService) {
    this.topBarContent = topBarContent;
    this.albumArtFrame = null;
    this.albumArtImage = null;
    this.loadedAlbumArtKey = null;
    this.loadingAlbumArtKey = null;
    this.loadedAlbumArtPixbuf = null;
    this.preparedAlbumArt = null;
    this.loadedFallbackIcon = null;
    this.albumArtLoadGeneration = 0;
    this.albumArtLoadCancellable = null;
    this.panelHeightSignalId = null;
    this.artworkService = artworkService;
    this.fallbackAlbumArtIcon = Gio.ThemedIcon.new_from_names([
      IconNames.MEDIA,
      IconNames.MISSING,
    ]);
  }

  get settings() {
    return this.topBarContent.settings;
  }

  get player() {
    return this.topBarContent.player;
  }

  get actor() {
    return this.albumArtFrame;
  }

  render(index, parentBox) {
    this.ensureActor();
    this.ensurePanelHeightSignal();

    const geometry = this.getAlbumArtGeometry();
    const request = createArtworkRequest({
      busName: this.player.busName,
      track: this.player.track,
      ...geometry,
    });

    this.syncAlbumArtGeometry(geometry.width, geometry.radius);
    placeActorAtIndex(this.albumArtFrame, parentBox, index);

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

  getAlbumArtGeometry() {
    const width = this.getAlbumArtSize();
    const configuredRadius = Number.isFinite(
      this.settings.artworkCornerRadius,
    )
      ? this.settings.artworkCornerRadius
      : TOP_BAR_ARTWORK_CORNER_RADIUS_CONSTRAINTS.DEFAULT;

    return {
      width,
      radius: calculateArtworkCornerRadius(width, configuredRadius),
    };
  }

  getAlbumArtSize() {
    const measuredHeight = Number(Main.panel?.height);
    const panelHeight =
      Number.isFinite(measuredHeight) && measuredHeight > 0
        ? Math.round(measuredHeight)
        : DEFAULT_PANEL_HEIGHT;

    return Math.max(1, Math.round(panelHeight * PANEL_HEIGHT_RATIO));
  }

  ensureActor() {
    if (this.albumArtFrame) return;

    this.albumArtImage = createIcon(
      {
        styleClass: MediaShellStyleClasses.ALBUM_ART_IMAGE,
        xExpand: false,
        yExpand: false,
        xAlign: Clutter.ActorAlign.CENTER,
        yAlign: Clutter.ActorAlign.CENTER,
      },
      IconNames.MEDIA,
    );
    this.albumArtFrame = new St.Bin({
      styleClass: styleClassNames(
        MediaShellStyleClasses.ALBUM_ART_FRAME,
        MediaShellStyleClasses.TOP_BAR_ALBUM_ART,
      ),
      xExpand: false,
      yExpand: false,
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
      opacity: 0,
    });
    this.albumArtFrame.set_child(this.albumArtImage);
  }

  ensurePanelHeightSignal() {
    if (this.panelHeightSignalId !== null || !Main.panel) return;
    this.panelHeightSignalId = Main.panel.connect("notify::height", () =>
      this.syncCurrentGeometry(),
    );
  }

  disconnectPanelHeightSignal() {
    if (this.panelHeightSignalId === null || !Main.panel) return;
    Main.panel.disconnect(this.panelHeightSignalId);
    this.panelHeightSignalId = null;
  }

  syncCurrentGeometry() {
    if (!this.albumArtFrame) return;
    const geometry = this.getAlbumArtGeometry();
    this.syncAlbumArtGeometry(geometry.width, geometry.radius);
    this.syncLoadedAlbumArt(geometry.width, geometry.radius);
  }

  syncAlbumArtGeometry(width, radius) {
    const { frameSize, frameRadius, imageSize, imageRadius } =
      getArtworkPresentationGeometry(width, radius);

    this.albumArtFrame.style = `border-radius: ${frameRadius}px; padding: ${ARTWORK_OUTLINE_WIDTH}px;`;
    this.albumArtFrame.set_size(frameSize, frameSize);
    this.albumArtImage.style = `border-radius: ${imageRadius}px;`;
    this.albumArtImage.set_size(imageSize, imageSize);
  }

  async loadAlbumArt(request) {
    const loadGeneration = ++this.albumArtLoadGeneration;
    const loadCancellable = new Gio.Cancellable();
    this.albumArtLoadCancellable = loadCancellable;
    this.loadingAlbumArtKey = request.key;

    try {
      const { pixbuf, fallbackIcon } = await this.artworkService.load(
        request,
        loadCancellable,
      );
      if (!this.isCurrentLoad(loadGeneration, loadCancellable, request)) return;

      this.commitAlbumArtResult(request, pixbuf, fallbackIcon);
    } catch (error) {
      if (
        !isCancellationError(error) &&
        this.isCurrentLoad(loadGeneration, loadCancellable, request)
      ) {
        logger.warnOnce(
          `processing:${request.busName}`,
          "Top-bar album art could not be processed; using the fallback icon",
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
    this.syncCurrentGeometry();
  }

  syncLoadedAlbumArt(width, radius) {
    if (!this.albumArtFrame || !this.loadedAlbumArtKey) return;

    if (this.loadedAlbumArtPixbuf)
      this.setAlbumArtPixbuf(width, radius, this.loadedAlbumArtPixbuf);
    else this.setAlbumArtFallback(width, radius, this.loadedFallbackIcon);
  }

  setAlbumArtPixbuf(width, radius, pixbuf) {
    const { imageSize, imageRadius } = getArtworkPresentationGeometry(
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
        pixbuf: prepareArtworkPixbuf(pixbuf, imageSize, imageRadius),
      };
    }
    const renderPixbuf = this.preparedAlbumArt.pixbuf;

    this.albumArtImage.content = null;
    this.albumArtImage.remove_style_class_name(NativeStyleClasses.BUTTON);
    this.albumArtImage.remove_style_class_name(MediaShellStyleClasses.ALBUM_ART_FALLBACK);
    setGIcon(this.albumArtImage, renderPixbuf, IconNames.MEDIA);
    this.albumArtImage.set_icon_size(imageSize);
    this.albumArtFrame.opacity = 255;
  }

  setAlbumArtFallback(width, radius, icon) {
    const { imageSize, fallbackIconSize } = getArtworkPresentationGeometry(
      width,
      radius,
    );
    this.syncAlbumArtGeometry(width, radius);
    this.albumArtImage.content = null;
    this.albumArtImage.add_style_class_name(NativeStyleClasses.BUTTON);
    this.albumArtImage.add_style_class_name(MediaShellStyleClasses.ALBUM_ART_FALLBACK);
    setGIcon(
      this.albumArtImage,
      icon ?? this.fallbackAlbumArtIcon,
      IconNames.MEDIA,
    );
    this.albumArtImage.set_icon_size(fallbackIconSize);
    this.albumArtImage.set_size(imageSize, imageSize);
    this.albumArtFrame.opacity = 255;
  }

  isCurrentLoad(loadGeneration, loadCancellable, request) {
    return (
      this.albumArtFrame &&
      loadGeneration === this.albumArtLoadGeneration &&
      !loadCancellable.is_cancelled() &&
      this.loadingAlbumArtKey === request.key &&
      this.player?.busName === request.busName
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
    this.disconnectPanelHeightSignal();
    this.loadedAlbumArtKey = null;
    this.loadedAlbumArtPixbuf = null;
    this.preparedAlbumArt = null;
    this.loadedFallbackIcon = null;
    if (!this.albumArtFrame) return;

    this.albumArtFrame.get_parent()?.remove_child(this.albumArtFrame);
    this.albumArtFrame.destroy();
    this.albumArtFrame = null;
    this.albumArtImage = null;
  }

  destroy() {
    this.remove();
    this.artworkService = null;
    this.fallbackAlbumArtIcon = null;
    this.topBarContent = null;
  }
}
