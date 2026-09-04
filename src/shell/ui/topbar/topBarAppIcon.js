/**
 * @file topBarAppIcon.js
 * @module shell.ui.topbar.topBarAppIcon
 *
 * Displays the desktop-app icon resolved for the active MPRIS player.
 *
 * TopBarContent owns this component and injects the lifecycle-scoped desktop-app
 * resolver. The component keeps icon actor creation and updates separate from
 * track text, visualizer, and playback control layout.
 */

import {
  MediaShellStyleClasses,
  NativeStyleClasses,
  styleClassNames,
} from "../style.js";
import { IconNames } from "../../../shared/icons.js";
import { placeActorAtIndex } from "../components/actorOrder.js";
import { createIcon, setGIcon } from "../icons.js";

/**
 * Displays the desktop-app icon resolved for the active MPRIS player.
 */
export default class TopBarAppIcon {
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

  get player() {
    return this.topBarContent.player;
  }

  render(index, parentBox) {
    const identity = this.player.identity;
    const desktopEntry = this.player.desktopEntry;
    const useColoredIcon = this.settings.appIconUseColor;
    const iconKey = `${this.player.busName}\u0001${identity}\u0001${desktopEntry}`;

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
        this.player.busName,
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
          NativeStyleClasses.SYSTEM_STATUS_ICON,
          MediaShellStyleClasses.TOP_BAR_APP_ICON,
          NativeStyleClasses.NO_MARGIN,
          useColoredIcon
            ? MediaShellStyleClasses.COLORED_ICON
            : MediaShellStyleClasses.SYMBOLIC_ICON,
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
