/**
 * @file topBarMediaAppIcon.js
 * @module shell.ui.topbar.topBarMediaAppIcon
 *
 * Displays the active media app's icon in the GNOME top bar.
 *
 * TopBarContent owns this component and injects the lifecycle-scoped desktop-app
 * resolver. The component keeps icon actor creation and updates separate from
 * track text, visualizer, and playback control layout.
 */

import { IconNames } from "../../../shared/icons.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import { placeActorAtIndex } from "../components/actorOrder.js";
import { createIcon, setGIcon } from "../../utils/icons.js";
import { styleClassNames } from "../../utils/styleClasses.js";

/**
 * Displays the active media app's icon in the GNOME top bar.
 */
export default class TopBarMediaAppIcon {
  constructor(topBarContent, desktopAppResolver) {
    this.topBarContent = topBarContent;
    this.actor = null;
    this.iconKey = null;
    this.usesColoredIcon = null;
    this.desktopAppResolver = desktopAppResolver;
  }

  get settings() {
    return this.topBarContent.settings;
  }

  get mediaApp() {
    return this.topBarContent.mediaApp;
  }

  render(index, parentBox) {
    const identity = this.mediaApp.identity;
    const desktopEntry = this.mediaApp.desktopEntry;
    const useColoredIcon = this.settings.mediaAppIconUseColor;
    const iconKey = `${this.mediaApp.busName}\u0001${identity}\u0001${desktopEntry}`;

    // St can retain the previously resolved symbolic/regular texture when
    // only the CSS icon style changes. Replacing this tiny actor on a mode
    // toggle makes the setting visible immediately without rebuilding the
    // complete top bar indicator.
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
      // Do not memoize a transient miss: Shell may associate a browser
      // window with its desktop app shortly after MPRIS appears.
      this.iconKey =
        desktopApp &&
        this.desktopAppResolver.hasResolvedDesktopAppIcon(desktopApp)
          ? iconKey
          : null;
    }

    this.attach(index, parentBox);
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

  attach(index, parentBox) {
    placeActorAtIndex(this.actor, parentBox, index);
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
