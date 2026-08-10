/**
 * @file TopBarAlbumArt.js
 * @module shell.ui.topBar.TopBarAlbumArt
 *
 * Displays MPRIS album art as an independent top-bar metadata element.
 */

import Gio from "gi://Gio";

import { IconNames } from "../../../shared/constants/icons.js";
import {
  calculateAlbumArtCornerRadius,
  calculateAlbumArtDisplaySize,
  createAlbumArtRequest,
} from "../../../shared/utils/albumArt.js";
import { createLogger } from "../../../shared/utils/log.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import AlbumArtLoader from "../../services/AlbumArtLoader.js";
import { decodeAlbumArtSource } from "../../utils/albumArtDecode.js";
import {
  cropPixbufToSquare,
  roundPixbufCorners,
} from "../../utils/albumArtPixbuf.js";
import { placeActorAtIndex } from "../../utils/actors.js";
import { isCancellationError } from "../../utils/errors.js";
import { createIcon, setGIcon } from "../../utils/icons.js";
import { resolveAlbumArtSource } from "../../utils/albumArtSource.js";

const RENDER_SCALE = 2;
const DEFAULT_PANEL_HEIGHT = 32;
const logger = createLogger("TopBarAlbumArt");

/** Displays configurable album art in the GNOME top bar. */
export default class TopBarAlbumArt {
  constructor(topBarContent) {
    this.topBarContent = topBarContent;
    this.actor = null;
    this.loadedAlbumArtKey = null;
    this.loadingAlbumArtKey = null;
    this.albumArtLoadGeneration = 0;
    this.albumArtLoadCancellable = null;
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

  render(index, parentBox) {
    const size = this.getAlbumArtSize();
    const radius = calculateAlbumArtCornerRadius(
      size,
      this.extensionController.topBarAlbumArtCornerRadiusPercent,
    );
    const request = createAlbumArtRequest({
      busName: this.mediaApp.busName,
      metadata: this.mediaApp.metadata,
      width: size,
      radius,
      cacheEnabled: this.extensionController.albumArtCacheEnabled,
    });

    this.ensureActor(request.width, request.radius);
    placeActorAtIndex(this.actor, parentBox, index);
    if (
      this.loadedAlbumArtKey === request.key ||
      this.loadingAlbumArtKey === request.key
    )
      return;

    this.cancelAlbumArtLoad();
    this.setFallback(request.width, request.radius);
    this.loadAlbumArt(request);
  }

  getAlbumArtSize() {
    const indicator = this.topBarContent.indicator;
    const measuredHeight = Number(indicator?.height);
    const panelHeight =
      Number.isFinite(measuredHeight) && measuredHeight > 0
        ? Math.round(measuredHeight)
        : DEFAULT_PANEL_HEIGHT;
    let availableHeight = panelHeight;
    if (indicator?.get_stage?.()) {
      try {
        availableHeight = Math.max(
          1,
          Math.round(
            panelHeight - indicator.get_theme_node().get_vertical_padding(),
          ),
        );
      } catch {
        // A Shell theme can be replaced while the indicator is being mapped.
      }
    }
    return calculateAlbumArtDisplaySize(
      availableHeight,
      this.extensionController.topBarAlbumArtSizePercent,
    );
  }

  ensureActor(size, radius) {
    if (!this.actor)
      this.actor = createIcon(
        { styleClass: StyleClasses.TOP_BAR_ALBUM_ART },
        IconNames.MEDIA,
      );
    this.syncGeometry(size, radius);
  }

  syncGeometry(size, radius) {
    this.actor.width = size;
    this.actor.height = size;
    this.actor.style = `border-radius: ${radius}px;`;
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
      if (!this.isCurrentLoad(loadGeneration, loadCancellable, request)) {
        try {
          albumArtSource?.stream?.close(null);
        } catch {
          // Cancellation may close a stale stream before this continuation.
        }
        return;
      }

      const pixbuf = await decodeAlbumArtSource({
        albumArtLoader: this.albumArtLoader,
        albumArtSource,
        size: request.width,
        loadCancellable,
      });
      if (!this.isCurrentLoad(loadGeneration, loadCancellable, request)) return;

      if (pixbuf) this.setPixbuf(request, pixbuf);
      else this.setFallback(request.width, request.radius, fallbackIcon);
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
        this.setFallback(request.width, request.radius);
      }
    } finally {
      if (this.isCurrentLoad(loadGeneration, loadCancellable, request)) {
        // Cache unavailable results too, avoiding repeated requests on unrelated
        // MPRIS metadata changes.
        this.loadedAlbumArtKey = request.key;
        this.loadingAlbumArtKey = null;
        this.albumArtLoadCancellable = null;
      }
    }
  }

  setPixbuf(request, pixbuf) {
    const renderSize = request.width * RENDER_SCALE;
    const orientedPixbuf = pixbuf.apply_embedded_orientation?.() ?? pixbuf;
    const squarePixbuf = cropPixbufToSquare(orientedPixbuf, renderSize);
    const renderPixbuf =
      request.radius > 0
        ? roundPixbufCorners(squarePixbuf, request.radius * RENDER_SCALE)
        : squarePixbuf;
    setGIcon(this.actor, renderPixbuf, IconNames.MEDIA);
    this.actor.set_icon_size(request.width);
  }

  setFallback(size, radius, icon = this.fallbackAlbumArtIcon) {
    this.syncGeometry(size, radius);
    setGIcon(this.actor, icon ?? this.fallbackAlbumArtIcon, IconNames.MEDIA);
    this.actor.set_icon_size(size);
  }

  isCurrentLoad(loadGeneration, loadCancellable, request) {
    return (
      this.actor &&
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
    this.actor?.get_parent()?.remove_child(this.actor);
    this.actor?.destroy();
    this.actor = null;
  }

  destroy() {
    this.remove();
    this.albumArtLoader = null;
    this.fallbackAlbumArtIcon = null;
    this.topBarContent = null;
  }
}
