/**
 * @file topBarArtwork.js
 * @module shell.ui.topbar.topBarArtwork
 *
 * Displays artwork from the active MPRIS track as an independent top-bar element.
 */

import {
  MediaShellStyleClasses,
  NativeStyleClasses,
  styleClassNames,
} from "../style.js";
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
const logger = createLogger("TopBarArtwork");

/** Displays configurable artwork in the GNOME top bar. */
export default class TopBarArtwork {
  constructor(topBarSurface, artworkService) {
    this.topBarSurface = topBarSurface;
    this.artworkFrame = null;
    this.artworkImage = null;
    this.loadedArtworkKey = null;
    this.loadingArtworkKey = null;
    this.loadedArtworkPixbuf = null;
    this.preparedArtwork = null;
    this.loadedFallbackIcon = null;
    this.artworkLoadGeneration = 0;
    this.artworkLoadCancellable = null;
    this.panelHeightSignalId = null;
    this.artworkService = artworkService;
    this.fallbackArtworkIcon = Gio.ThemedIcon.new_from_names([
      IconNames.MEDIA,
      IconNames.MISSING,
    ]);
  }

  get settings() {
    return this.topBarSurface.settings;
  }

  get player() {
    return this.topBarSurface.player;
  }

  get actor() {
    return this.artworkFrame;
  }

  render(index, parentBox) {
    this.ensureActor();
    this.ensurePanelHeightSignal();

    const geometry = this.getArtworkGeometry();
    const request = createArtworkRequest({
      busName: this.player.busName,
      track: this.player.track,
      ...geometry,
    });

    this.syncArtworkGeometry(geometry.width, geometry.radius);
    placeActorAtIndex(this.artworkFrame, parentBox, index);

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
    const width = this.getArtworkSize();
    const configuredRadius = Number.isFinite(this.settings.artworkCornerRadius)
      ? this.settings.artworkCornerRadius
      : TOP_BAR_ARTWORK_CORNER_RADIUS_CONSTRAINTS.DEFAULT;

    return {
      width,
      radius: calculateArtworkCornerRadius(width, configuredRadius),
    };
  }

  getArtworkSize() {
    const measuredHeight = Number(Main.panel?.height);
    const panelHeight =
      Number.isFinite(measuredHeight) && measuredHeight > 0
        ? Math.round(measuredHeight)
        : DEFAULT_PANEL_HEIGHT;

    return Math.max(1, Math.round(panelHeight * PANEL_HEIGHT_RATIO));
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
      styleClass: styleClassNames(
        MediaShellStyleClasses.ARTWORK_FRAME,
        MediaShellStyleClasses.TOP_BAR_ARTWORK,
      ),
      xExpand: false,
      yExpand: false,
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
      opacity: 0,
    });
    this.artworkFrame.set_child(this.artworkImage);
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
    if (!this.artworkFrame) return;
    const geometry = this.getArtworkGeometry();
    this.syncArtworkGeometry(geometry.width, geometry.radius);
    this.syncLoadedArtwork(geometry.width, geometry.radius);
  }

  syncArtworkGeometry(width, radius) {
    const { frameSize, frameRadius, imageSize, imageRadius } =
      getArtworkPresentationGeometry(width, radius);

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
          "Top-bar artwork could not be processed; using the fallback icon",
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
    this.syncCurrentGeometry();
  }

  syncLoadedArtwork(width, radius) {
    if (!this.artworkFrame || !this.loadedArtworkKey) return;

    if (this.loadedArtworkPixbuf)
      this.setArtworkPixbuf(width, radius, this.loadedArtworkPixbuf);
    else this.setArtworkFallback(width, radius, this.loadedFallbackIcon);
  }

  setArtworkPixbuf(width, radius, pixbuf) {
    const { imageSize, imageRadius } = getArtworkPresentationGeometry(
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
    const { imageSize, fallbackIconSize } = getArtworkPresentationGeometry(
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
    this.disconnectPanelHeightSignal();
    this.loadedArtworkKey = null;
    this.loadedArtworkPixbuf = null;
    this.preparedArtwork = null;
    this.loadedFallbackIcon = null;
    if (!this.artworkFrame) return;

    this.artworkFrame.get_parent()?.remove_child(this.artworkFrame);
    this.artworkFrame.destroy();
    this.artworkFrame = null;
    this.artworkImage = null;
  }

  destroy() {
    this.remove();
    this.artworkService = null;
    this.fallbackArtworkIcon = null;
    this.topBarSurface = null;
  }
}
