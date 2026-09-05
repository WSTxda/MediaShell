/**
 * @file popupPlayerSelectorButton.js
 * @module shell.ui.popup.popupPlayerSelectorButton
 *
 * Renders the popup player selector button for the active player.
 *
 * The button displays the active player and opens PopupPlayerSelectorList when
 * multiple players are available. It owns its actors and click action; row
 * selection and pinning remain owned by the selector list.
 */

import {
  MediaShellStyleClasses,
  NativeStyleClasses,
  styleClassNames,
} from "../style.js";
import Clutter from "gi://Clutter";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { IconNames } from "../../../shared/icons.js";
import { createIcon, setGIcon } from "../icons.js";
import { installPrimaryClickAction } from "../input/pointerActions.js";

/**
 * Renders the popup player selector button for the active player.
 */
export default class PopupPlayerSelectorButton {
  constructor(popupSurface, desktopAppResolver, onActivate) {
    this.popupSurface = popupSurface;
    this.onActivate = onActivate;
    this.container = null;
    this.button = null;
    this.icon = null;
    this.label = null;
    this.expandIcon = null;
    this.renderKey = null;
    this.hasMultiplePlayers = null;
    this.disconnectButtonClickAction = null;
    this.desktopAppResolver = desktopAppResolver;
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
  get actor() {
    return this.container;
  }
  get interactiveActor() {
    return this.button;
  }

  render() {
    this.ensureActors();

    const hasMultiplePlayers =
      (this.popupSurface.mediaRuntime?.getAvailablePlayers() ?? []).length > 1;
    if (hasMultiplePlayers !== this.hasMultiplePlayers) {
      this.hasMultiplePlayers = hasMultiplePlayers;
      this.button.reactive = hasMultiplePlayers;
      this.button.trackHover = hasMultiplePlayers;
      this.button.canFocus = hasMultiplePlayers;
      this.expandIcon.visible = hasMultiplePlayers;
      if (hasMultiplePlayers)
        this.button.add_style_class_name(NativeStyleClasses.BUTTON);
      else this.button.remove_style_class_name(NativeStyleClasses.BUTTON);
    }

    const identity = this.player.identity;
    const desktopEntry = this.player.desktopEntry;
    const coloredClass = this.settings.appIconUseColor
      ? MediaShellStyleClasses.COLORED_ICON
      : MediaShellStyleClasses.SYMBOLIC_ICON;
    const renderKey = `${this.player.busName}\u0001${identity}\u0001${desktopEntry}\u0001${coloredClass}`;
    if (renderKey !== this.renderKey) {
      const desktopApp = this.desktopAppResolver.resolveDesktopApp(
        identity,
        desktopEntry,
        this.player.busName,
      );
      this.label.text = this.desktopAppResolver.getDesktopAppName(
        desktopApp,
        identity || _("Unknown app"),
      );
      setGIcon(
        this.icon,
        this.desktopAppResolver.getDesktopAppIcon(desktopApp),
        IconNames.MEDIA,
      );
      this.icon.set_style_class_name(
        styleClassNames(
          NativeStyleClasses.POPUP_MENU_ICON,
          MediaShellStyleClasses.POPUP_PLAYER_SELECTOR_BUTTON_ICON,
          coloredClass,
        ),
      );
      this.renderKey =
        desktopApp &&
        this.desktopAppResolver.hasResolvedDesktopAppIcon(desktopApp)
          ? renderKey
          : null;
    }

    if (!this.container.get_parent()) {
      this.popupItem.add_child(this.container);
    }
  }

  ensureActors() {
    if (this.container) return;

    this.container = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: MediaShellStyleClasses.POPUP_PLAYER_SELECTOR,
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.button = new St.BoxLayout({
      styleClass: styleClassNames(
        NativeStyleClasses.QUICK_MENU_TOGGLE,
        MediaShellStyleClasses.POPUP_PLAYER_SELECTOR_BUTTON,
      ),
      xAlign: Clutter.ActorAlign.CENTER,
      reactive: true,
      trackHover: true,
    });
    this.icon = createIcon({
      styleClass: styleClassNames(
        NativeStyleClasses.POPUP_MENU_ICON,
        MediaShellStyleClasses.POPUP_PLAYER_SELECTOR_BUTTON_ICON,
        MediaShellStyleClasses.SYMBOLIC_ICON,
      ),
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.label = new St.Label({
      styleClass: MediaShellStyleClasses.POPUP_PLAYER_SELECTOR_BUTTON_LABEL,
      yAlign: Clutter.ActorAlign.CENTER,
      xAlign: Clutter.ActorAlign.CENTER,
      xExpand: true,
    });
    this.expandIcon = createIcon({
      iconName: "go-next-symbolic",
      styleClass: styleClassNames(
        NativeStyleClasses.POPUP_MENU_ICON,
        MediaShellStyleClasses.POPUP_PLAYER_SELECTOR_BUTTON_EXPAND_ICON,
      ),
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.installClickAction();
    this.button.add_child(this.icon);
    this.button.add_child(this.label);
    this.button.add_child(this.expandIcon);
    this.container.add_child(this.button);
  }

  installClickAction() {
    this.disconnectButtonClickAction = installPrimaryClickAction(
      this.button,
      () => this.onActivate?.(),
      () =>
        (this.popupSurface.mediaRuntime?.getAvailablePlayers() ?? []).length >
        1,
    );
  }

  destroy() {
    this.disconnectButtonClickAction?.();
    this.disconnectButtonClickAction = null;

    this.container?.destroy();
    this.container = null;
    this.button = null;
    this.icon = null;
    this.label = null;
    this.expandIcon = null;
    this.renderKey = null;
    this.desktopAppResolver = null;
    this.onActivate = null;
    this.popupSurface = null;
  }
}
