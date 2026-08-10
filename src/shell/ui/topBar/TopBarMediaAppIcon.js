/**
 * @file TopBarMediaAppIcon.js
 * @module shell.ui.topBar.TopBarMediaAppIcon
 *
 * Displays the active media app's icon in the GNOME top bar.
 *
 * Album art is intentionally rendered by TopBarAlbumArt as an independent,
 * reorderable metadata element.
 */

import { IconNames } from "../../../shared/constants/icons.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import DesktopAppResolver from "../../services/DesktopAppResolver.js";
import { placeActorAtIndex } from "../../utils/actors.js";
import { createIcon, setGIcon } from "../../utils/icons.js";
import { styleClassNames } from "../../utils/styleClasses.js";

/** Displays the active media app's icon in the GNOME top bar. */
export default class TopBarMediaAppIcon {
  constructor(topBarContent) {
    this.topBarContent = topBarContent;
    this.actor = null;
    this.iconKey = null;
    this.usesColoredIcon = null;
    this.desktopAppResolver = DesktopAppResolver.getInstance();
  }

  get extensionController() {
    return this.topBarContent.extensionController;
  }

  get mediaApp() {
    return this.topBarContent.mediaApp;
  }

  render(index, parentBox) {
    const identity = this.mediaApp.identity;
    const desktopEntry = this.mediaApp.desktopEntry;
    const useColoredIcon = this.extensionController.topBarMediaAppIconUseColor;
    const iconKey = `${this.mediaApp.busName}\u0001${identity}\u0001${desktopEntry}`;

    if (!this.actor || this.usesColoredIcon !== useColoredIcon)
      this.replaceIconActor(index, useColoredIcon);

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

    placeActorAtIndex(this.actor, parentBox, index);
  }

  replaceIconActor(index, useColoredIcon) {
    const previous = this.actor;
    const parent = previous?.get_parent() ?? null;
    const previousIndex = parent ? parent.get_children().indexOf(previous) : -1;

    this.actor = createIcon(
      {
        styleClass: styleClassNames(
          StyleClasses.SYSTEM_STATUS_ICON,
          StyleClasses.TOP_BAR_MEDIA_APP_ICON,
          StyleClasses.NO_MARGIN,
          useColoredIcon
            ? StyleClasses.COLORED_ICON
            : StyleClasses.SYMBOLIC_ICON,
        ),
      },
      IconNames.MEDIA,
    );
    this.iconKey = null;
    this.usesColoredIcon = useColoredIcon;

    if (parent) {
      parent.insert_child_at_index(
        this.actor,
        previousIndex >= 0 ? previousIndex : index,
      );
      parent.remove_child(previous);
    }
    previous?.destroy();
  }

  remove() {
    if (!this.actor) return;
    this.actor.get_parent()?.remove_child(this.actor);
    this.actor.destroy();
    this.actor = null;
    this.iconKey = null;
    this.usesColoredIcon = null;
  }

  destroy() {
    this.remove();
    this.desktopAppResolver = null;
    this.topBarContent = null;
  }
}
