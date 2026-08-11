/**
 * @file TopBarAlbumArt.js
 * @module shell.ui.topBar.TopBarAlbumArt
 *
 * Displays MPRIS album art as an independent top-bar metadata element.
 */

import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { IconNames } from "../../../shared/constants/icons.js";
import { ALBUM_ART_CORNER_RADIUS_CONSTRAINTS } from "../../../shared/constants/settings.js";
import {
  calculateAlbumArtCornerRadius,
  createAlbumArtRequest,
} from "../../../shared/utils/albumArt.js";
import { createLogger } from "../../../shared/utils/log.js";
import { ALBUM_ART_OUTLINE_WIDTH } from "../../constants/albumArt.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import AlbumArtLoader from "../../services/AlbumArtLoader.js";
import { decodeAlbumArtSource } from "../../utils/albumArtDecode.js";
import { prepareAlbumArtPixbuf } from "../../utils/albumArtPixbuf.js";
import { getAlbumArtPresentationGeometry } from "../../utils/albumArtPresentation.js";
import { resolveAlbumArtSource } from "../../utils/albumArtSource.js";
import { placeActorAtIndex } from "../../utils/actors.js";
import { isCancellationError } from "../../utils/errors.js";
import { createIcon, setGIcon } from "../../utils/icons.js";
import { styleClassNames } from "../../utils/styleClasses.js";

const DEFAULT_PANEL_HEIGHT = 32;
const PANEL_HEIGHT_RATIO = 0.65;
const logger = createLogger("TopBarAlbumArt");

/** Displays configurable album art in the GNOME top bar. */
export default class TopBarAlbumArt {
  constructor(topBarContent) {
    this.topBarContent = topBarContent;
    this.albumArtFrame = null;
    this.albumArtImage = null;
    this.loadedAlbumArtKey = null;
    this.loadingAlbumArtKey = null;
    this.loadedAlbumArtPixbuf = null;
    this.loadedFallbackIcon = null;
    this.albumArtLoadGeneration = 0;
    this.albumArtLoadCancellable = null;
    this.panelHeightSignalId = null;
    this.albumArtLoader = AlbumArtLoader.getInstance();
    this.fallbackAlbumArtIcon = Gio.ThemedIcon.new_from_names([
      IconNames.MEDIA,
      IconNames.MISSING,
    ]);
  }

  get extensionController() {
    return this.topBarContent.extensionController;
  }

  get mediaApp() {
    return this.topBarContent.mediaApp;
  }

  get actor() {
    return this.albumArtFrame;
  }

  render(index, parentBox) {
    this.ensureActor();
    this.ensurePanelHeightSignal();

    const geometry = this.getAlbumArtGeometry();
    const request = createAlbumArtRequest({
      busName: this.mediaApp.busName,
      metadata: this.mediaApp.metadata,
      ...geometry,
      cacheEnabled: this.extensionController.albumArtCacheEnabled,
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
      this.extensionController.topBarAlbumArtCornerRadius,
    )
      ? this.extensionController.topBarAlbumArtCornerRadius
      : ALBUM_ART_CORNER_RADIUS_CONSTRAINTS.DEFAULT;

    return {
      width,
      radius: calculateAlbumArtCornerRadius(width, configuredRadius),
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
        styleClass: StyleClasses.ALBUM_ART_IMAGE,
        xExpand: false,
        yExpand: false,
        xAlign: Clutter.ActorAlign.CENTER,
        yAlign: Clutter.ActorAlign.CENTER,
      },
      IconNames.MEDIA,
    );
    this.albumArtFrame = new St.Bin({
      styleClass: styleClassNames(
        StyleClasses.ALBUM_ART_FRAME,
        StyleClasses.TOP_BAR_ALBUM_ART,
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
      getAlbumArtPresentationGeometry(width, radius);

    this.albumArtFrame.style = `border-radius: ${frameRadius}px; padding: ${ALBUM_ART_OUTLINE_WIDTH}px;`;
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
      const { albumArtSource, fallbackIcon } = await resolveAlbumArtSource({
        albumArtLoader: this.albumArtLoader,
        ...request,
        loadCancellable,
      });
      const pixbuf = await decodeAlbumArtSource({
        albumArtLoader: this.albumArtLoader,
        albumArtSource,
        size: request.width,
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
    const { imageSize, imageRadius } = getAlbumArtPresentationGeometry(
      width,
      radius,
    );
    const renderPixbuf = prepareAlbumArtPixbuf(pixbuf, imageSize, imageRadius);

    this.albumArtImage.content = null;
    this.albumArtImage.remove_style_class_name(StyleClasses.BUTTON);
    this.albumArtImage.remove_style_class_name(StyleClasses.ALBUM_ART_FALLBACK);
    setGIcon(this.albumArtImage, renderPixbuf, IconNames.MEDIA);
    this.albumArtImage.set_icon_size(imageSize);
    this.albumArtFrame.opacity = 255;
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
    this.disconnectPanelHeightSignal();
    this.loadedAlbumArtKey = null;
    this.loadedAlbumArtPixbuf = null;
    this.loadedFallbackIcon = null;
    if (!this.albumArtFrame) return;

    this.albumArtFrame.get_parent()?.remove_child(this.albumArtFrame);
    this.albumArtFrame.destroy();
    this.albumArtFrame = null;
    this.albumArtImage = null;
  }

  destroy() {
    this.remove();
    this.albumArtLoader = null;
    this.fallbackAlbumArtIcon = null;
    this.topBarContent = null;
  }
}
