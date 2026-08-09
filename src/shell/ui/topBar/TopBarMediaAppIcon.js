/**
 * @file TopBarMediaAppIcon.js
 * @module shell.ui.topBar.TopBarMediaAppIcon
 *
 * Displays either the active media app's icon or its album-art thumbnail.
 *
 * TopBarContent owns this component and supplies the selected display style.
 * It keeps app resolution and asynchronous artwork loading isolated from the
 * rest of the top-bar layout.
 */

import GdkPixbuf from "gi://GdkPixbuf";
import Gio from "gi://Gio";

import { IconNames } from "../../../shared/constants/icons.js";
import { TopBarImageStyles } from "../../../shared/enums/topBar.js";
import { createLogger } from "../../../shared/utils/log.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import AlbumArtLoader from "../../services/AlbumArtLoader.js";
import DesktopAppResolver from "../../services/DesktopAppResolver.js";
import {
  cropPixbufToSquare,
  roundPixbufCorners,
} from "../../utils/albumArtPixbuf.js";
import { placeActorAtIndex } from "../../utils/actors.js";
import { isCancellationError } from "../../utils/errors.js";
import { createIcon, setGIcon } from "../../utils/icons.js";
import { styleClassNames } from "../../utils/styleClasses.js";

const THUMBNAIL_SIZE = 20;
const logger = createLogger("TopBarMediaAppIcon");

if (typeof GdkPixbuf?.Pixbuf?.new_from_stream_at_scale_async === "function") {
  Gio._promisify(
    GdkPixbuf.Pixbuf,
    "new_from_stream_at_scale_async",
    "new_from_stream_finish",
  );
}

/** Displays the configured media image in the GNOME top bar. */
export default class TopBarMediaAppIcon {
  constructor(topBarContent) {
    this.topBarContent = topBarContent;
    this.actor = null;
    this.iconKey = null;
    this.imageStyle = null;
    this.usesColoredIcon = null;
    this.thumbnailLoadGeneration = 0;
    this.thumbnailLoadCancellable = null;
    this.albumArtLoader = AlbumArtLoader.getInstance();
    this.desktopAppResolver = DesktopAppResolver.getInstance();
    this.fallbackThumbnailIcon = Gio.ThemedIcon.new_from_names([
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
    if (
      this.extensionController.topBarImageStyle === TopBarImageStyles.ALBUM_ART
    )
      this.renderThumbnail(index, parentBox);
    else this.renderAppIcon(index, parentBox);
  }

  renderAppIcon(index, parentBox) {
    const identity = this.mediaApp.identity;
    const desktopEntry = this.mediaApp.desktopEntry;
    const useColoredIcon = this.extensionController.topBarMediaAppIconUseColor;
    const iconKey = `${this.mediaApp.busName}\u0001${identity}\u0001${desktopEntry}`;

    this.cancelThumbnailLoad();
    if (
      !this.actor ||
      this.imageStyle !== TopBarImageStyles.APP_ICON ||
      this.usesColoredIcon !== useColoredIcon
    )
      this.replaceActor(
        index,
        styleClassNames(
          StyleClasses.SYSTEM_STATUS_ICON,
          StyleClasses.TOP_BAR_MEDIA_APP_ICON,
          StyleClasses.NO_MARGIN,
          useColoredIcon
            ? StyleClasses.COLORED_ICON
            : StyleClasses.SYMBOLIC_ICON,
        ),
        IconNames.MEDIA,
      );

    if (iconKey !== this.iconKey) {
      const desktopApp = this.desktopAppResolver.resolveDesktopApp(
        identity,
        desktopEntry,
        this.mediaApp.busName,
      );
      setGIcon(
        this.actor,
        this.desktopAppResolver.getDesktopAppIcon(desktopApp),
        IconNames.MEDIA,
      );
      this.iconKey =
        desktopApp &&
        this.desktopAppResolver.hasResolvedDesktopAppIcon(desktopApp)
          ? iconKey
          : null;
    }

    this.imageStyle = TopBarImageStyles.APP_ICON;
    this.usesColoredIcon = useColoredIcon;
    this.attach(index, parentBox);
  }

  renderThumbnail(index, parentBox) {
    const radius = this.extensionController.topBarThumbnailCornerRadius;
    if (!this.actor || this.imageStyle !== TopBarImageStyles.ALBUM_ART)
      this.replaceActor(
        index,
        styleClassNames(
          StyleClasses.NO_MARGIN,
          StyleClasses.TOP_BAR_ALBUM_ART_THUMBNAIL,
        ),
        IconNames.MEDIA,
      );

    this.imageStyle = TopBarImageStyles.ALBUM_ART;
    this.usesColoredIcon = null;
    this.attach(index, parentBox);

    const thumbnailKey = [
      this.mediaApp.busName,
      this.mediaApp.metadata?.["mpris:artUrl"] ?? "",
      radius,
      this.extensionController.albumArtCacheEnabled,
    ].join("\u0000");
    if (thumbnailKey === this.iconKey) return;

    this.cancelThumbnailLoad();
    this.iconKey = thumbnailKey;
    this.setThumbnailFallback();
    this.loadThumbnail(thumbnailKey, radius);
  }

  replaceActor(index, styleClass, fallbackIconName) {
    const previous = this.actor;
    const parent = previous?.get_parent() ?? null;
    const previousIndex = parent ? parent.get_children().indexOf(previous) : -1;
    this.actor = createIcon({ styleClass }, fallbackIconName);
    this.iconKey = null;
    if (parent) {
      parent.insert_child_at_index(
        this.actor,
        previousIndex >= 0 ? previousIndex : index,
      );
      parent.remove_child(previous);
    }
    previous?.destroy();
  }

  async loadThumbnail(thumbnailKey, radius) {
    const albumArtUri = this.mediaApp.metadata?.["mpris:artUrl"];
    if (!albumArtUri) return;

    const loadGeneration = ++this.thumbnailLoadGeneration;
    const loadCancellable = new Gio.Cancellable();
    this.thumbnailLoadCancellable = loadCancellable;
    try {
      const source = await this.albumArtLoader.loadAlbumArt(
        albumArtUri,
        this.extensionController.albumArtCacheEnabled,
        loadCancellable,
      );
      const pixbuf = await this.decodeThumbnail(
        source?.stream,
        loadCancellable,
      );
      if (
        !this.isCurrentThumbnailLoad(
          loadGeneration,
          loadCancellable,
          thumbnailKey,
        )
      )
        return;
      if (pixbuf) {
        const thumbnail = cropPixbufToSquare(pixbuf, THUMBNAIL_SIZE * 2);
        setGIcon(
          this.actor,
          roundPixbufCorners(thumbnail, radius * 2),
          IconNames.MEDIA,
        );
        this.actor.set_icon_size(THUMBNAIL_SIZE);
      }
    } catch (error) {
      if (
        !isCancellationError(error) &&
        this.isCurrentThumbnailLoad(
          loadGeneration,
          loadCancellable,
          thumbnailKey,
        )
      )
        logger.debugOnce(
          `thumbnail:${this.mediaApp.busName}`,
          "Top-bar album-art thumbnail could not be loaded",
          error,
        );
    } finally {
      if (
        this.isCurrentThumbnailLoad(
          loadGeneration,
          loadCancellable,
          thumbnailKey,
        )
      )
        this.thumbnailLoadCancellable = null;
    }
  }

  async decodeThumbnail(stream, loadCancellable) {
    if (!stream) return null;
    if (
      typeof GdkPixbuf?.Pixbuf?.new_from_stream_at_scale_async !== "function"
    ) {
      this.closeStream(stream);
      return null;
    }
    try {
      return await GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
        stream,
        THUMBNAIL_SIZE * 2,
        THUMBNAIL_SIZE * 2,
        true,
        loadCancellable,
      );
    } finally {
      this.closeStream(stream);
    }
  }

  isCurrentThumbnailLoad(loadGeneration, loadCancellable, thumbnailKey) {
    return (
      this.actor &&
      this.imageStyle === TopBarImageStyles.ALBUM_ART &&
      loadGeneration === this.thumbnailLoadGeneration &&
      !loadCancellable.is_cancelled() &&
      this.iconKey === thumbnailKey
    );
  }

  closeStream(stream) {
    if (!stream) return;
    try {
      stream.close(null);
    } catch (error) {
      logger.debugOnce(
        "thumbnail-stream-close",
        "Thumbnail stream was already closed",
        error,
      );
    }
  }

  cancelThumbnailLoad() {
    if (!this.thumbnailLoadCancellable) return;
    this.thumbnailLoadGeneration++;
    this.thumbnailLoadCancellable.cancel();
    this.thumbnailLoadCancellable = null;
  }

  setThumbnailFallback() {
    setGIcon(this.actor, this.fallbackThumbnailIcon, IconNames.MEDIA);
    this.actor.set_icon_size(THUMBNAIL_SIZE);
  }

  attach(index, parentBox) {
    placeActorAtIndex(this.actor, parentBox, index);
  }

  remove() {
    this.cancelThumbnailLoad();
    this.actor?.get_parent()?.remove_child(this.actor);
    this.actor?.destroy();
    this.actor = null;
    this.iconKey = null;
    this.imageStyle = null;
    this.usesColoredIcon = null;
  }

  destroy() {
    this.remove();
    this.albumArtLoader = null;
    this.desktopAppResolver = null;
    this.fallbackThumbnailIcon = null;
    this.topBarContent = null;
  }
}
