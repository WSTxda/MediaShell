/**
 * @file TopBarAlbumArt.js
 * @module shell.ui.topBar.TopBarAlbumArt
 *
 * Owns top-bar album-art actors, adaptive panel geometry, request generations,
 * cancellation, and visible fallback state. Shared source, decode, pixbuf, and
 * presentation helpers keep artwork behavior aligned with the popup.
 */

import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import St from "gi://St";

import { IconNames } from "../../../shared/constants/icons.js";
import {
  calculateAlbumArtCornerRadius,
  createAlbumArtRequest,
} from "../../../shared/utils/albumArt.js";
import { createLogger } from "../../../shared/utils/log.js";
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
import { placeActorAtIndex } from "../../utils/actors.js";
import { isCancellationError } from "../../utils/errors.js";
import { createIcon, setGIcon } from "../../utils/icons.js";
import { resolveAlbumArtSource } from "../../utils/albumArtSource.js";

const DEFAULT_PANEL_HEIGHT = 32;
const PANEL_HEIGHT_RATIO = 0.65;
const logger = createLogger("TopBarAlbumArt");

/** Owns album-art rendering and lifecycle for the top-bar surface. */
export default class TopBarAlbumArt {
  constructor(topBarContent) {
    this.topBarContent = topBarContent;
    this.indicator = topBarContent.indicator;
    this.actor = null;
    this.albumArtImage = null;
    this.panelGeometrySignalIds = [];
    this.albumArtLoadGeneration = 0;
    this.albumArtLoadCancellable = null;
    this.loadedAlbumArtSourceKey = null;
    this.loadingAlbumArtSourceKey = null;
    this.loadedAlbumArtPixbuf = null;
    this.loadedAlbumArtFallbackIcon = null;
    this.albumArtLoader = AlbumArtLoader.getInstance();
  }

  get extensionController() {
    return this.topBarContent.extensionController;
  }

  get mediaApp() {
    return this.topBarContent.mediaApp;
  }

  getCurrentGeometry() {
    const size = this.getAlbumArtSize();
    return {
      width: size,
      radius: calculateAlbumArtCornerRadius(
        size,
        this.extensionController.topBarAlbumArtCornerRadius,
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

  render(index, parentBox) {
    const request = this.createCurrentRequest();
    this.ensureActor(request.width, request.radius);
    placeActorAtIndex(this.actor, parentBox, index);

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
    void this.loadAlbumArt(request);
  }

  getAlbumArtSize() {
    const measuredHeight = Number(this.indicator.height);
    const panelHeight =
      Number.isFinite(measuredHeight) && measuredHeight > 0
        ? Math.round(measuredHeight)
        : DEFAULT_PANEL_HEIGHT;
    let availableHeight = panelHeight;

    // get_theme_node() is only valid after the actor has reached a stage.
    if (this.indicator.get_stage()) {
      availableHeight = Math.max(
        1,
        Math.round(
          panelHeight - this.indicator.get_theme_node().get_vertical_padding(),
        ),
      );
    }

    return Math.max(1, Math.round(availableHeight * PANEL_HEIGHT_RATIO));
  }

  ensureActor(size, radius) {
    if (this.actor) {
      this.syncAlbumArtGeometry(size, radius);
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
    this.actor = new St.Bin({
      styleClass: StyleClasses.ALBUM_ART_FRAME,
      xExpand: false,
      yExpand: false,
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.actor.set_child(this.albumArtImage);
    this.connectPanelGeometrySignals();
    this.setAlbumArtFallback(size, radius, null);
  }

  connectPanelGeometrySignals() {
    if (this.panelGeometrySignalIds.length > 0) return;
    const syncGeometry = () => this.syncCurrentPresentation();
    this.panelGeometrySignalIds.push(
      this.indicator.connect("notify::height", syncGeometry),
      this.indicator.connect("style-changed", syncGeometry),
    );
  }

  disconnectPanelGeometrySignals() {
    for (const signalId of this.panelGeometrySignalIds)
      this.indicator.disconnect(signalId);
    this.panelGeometrySignalIds.length = 0;
  }

  syncCurrentPresentation() {
    if (!this.actor) return;
    const { width, radius } = this.getCurrentGeometry();
    if (this.loadedAlbumArtSourceKey)
      this.syncLoadedPresentation(width, radius);
    else this.setAlbumArtFallback(width, radius, null);
  }

  async loadAlbumArt(request) {
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
      if (!this.isCurrentLoad(loadGeneration, loadCancellable, request)) {
        closeAlbumArtSource(albumArtSource);
        return;
      }

      const pixbuf = await decodeAlbumArtSource({
        albumArtLoader: this.albumArtLoader,
        albumArtSource,
        size: request.width,
        loadCancellable,
      });
      if (!this.isCurrentLoad(loadGeneration, loadCancellable, request)) return;

      this.setLoadedAlbumArt(request.sourceKey, pixbuf, fallbackIcon);
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
        this.setLoadedAlbumArt(request.sourceKey, null, null);
      }
    } finally {
      if (this.isCurrentLoad(loadGeneration, loadCancellable, request)) {
        this.loadingAlbumArtSourceKey = null;
        this.albumArtLoadCancellable = null;
      }
    }
  }

  setLoadedAlbumArt(sourceKey, pixbuf, fallbackIcon) {
    this.loadedAlbumArtSourceKey = sourceKey;
    this.loadedAlbumArtPixbuf = pixbuf;
    this.loadedAlbumArtFallbackIcon = fallbackIcon;
    this.syncCurrentPresentation();
  }

  clearLoadedAlbumArt() {
    this.loadedAlbumArtSourceKey = null;
    this.loadedAlbumArtPixbuf = null;
    this.loadedAlbumArtFallbackIcon = null;
  }

  syncLoadedPresentation(size, radius) {
    if (this.loadedAlbumArtPixbuf)
      this.setAlbumArtPixbuf(size, radius, this.loadedAlbumArtPixbuf);
    else
      this.setAlbumArtFallback(size, radius, this.loadedAlbumArtFallbackIcon);
  }

  setAlbumArtPixbuf(size, radius, pixbuf) {
    const { imageSize, imageRadius } = this.syncAlbumArtGeometry(size, radius);
    const renderPixbuf = prepareAlbumArtPixbuf(pixbuf, imageSize, imageRadius);

    setAlbumArtImagePresentation(this.albumArtImage);
    setGIcon(this.albumArtImage, renderPixbuf, IconNames.MEDIA);
    this.albumArtImage.set_icon_size(imageSize);
  }

  syncAlbumArtGeometry(size, radius) {
    return syncAlbumArtGeometry(this.actor, this.albumArtImage, size, radius);
  }

  setAlbumArtFallback(size, radius, icon) {
    const { imageSize } = this.syncAlbumArtGeometry(size, radius);
    setAlbumArtFallbackPresentation(this.albumArtImage);
    setGIcon(this.albumArtImage, icon, IconNames.MEDIA);
    this.albumArtImage.set_icon_size(getAlbumArtFallbackIconSize(imageSize));
  }

  isCurrentLoad(loadGeneration, loadCancellable, request) {
    return (
      this.actor &&
      loadGeneration === this.albumArtLoadGeneration &&
      !loadCancellable.is_cancelled() &&
      this.loadingAlbumArtSourceKey === request.sourceKey &&
      this.mediaApp?.busName === request.busName
    );
  }

  cancelAlbumArtLoad() {
    if (!this.albumArtLoadCancellable) return;
    this.albumArtLoadGeneration++;
    this.albumArtLoadCancellable.cancel();
    this.albumArtLoadCancellable = null;
    this.loadingAlbumArtSourceKey = null;
  }

  remove() {
    this.cancelAlbumArtLoad();
    this.clearLoadedAlbumArt();
    if (!this.actor) return;

    this.disconnectPanelGeometrySignals();
    this.actor.get_parent()?.remove_child(this.actor);
    this.actor.destroy();
    this.actor = null;
    this.albumArtImage = null;
  }

  destroy() {
    this.remove();
    this.albumArtLoader = null;
    this.indicator = null;
    this.topBarContent = null;
  }
}
