/**
 * @file popupMediaAppSelectorButton.js
 * @module shell.ui.popup.popupMediaAppSelectorButton
 *
 * Renders the popup media app selector button for the active media app.
 *
 * The button displays the active media app and opens PopupMediaAppSelectorList when
 * multiple media apps are available. It owns its actors and click action; row
 * selection and pinning remain the list/controller responsibility.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { IconNames } from "../../../shared/constants/icons.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import { createIcon, setGIcon } from "../../utils/icons.js";
import { installPrimaryClickAction } from "../../utils/pointerActions.js";
import { styleClassNames } from "../../utils/styleClasses.js";

/**
 * Renders the popup media app selector button for the active media app.
 */
export default class PopupMediaAppSelectorButton {
  constructor(popupContent, desktopAppResolver, onActivate) {
    this.popupContent = popupContent;
    this.onActivate = onActivate;
    this.container = null;
    this.button = null;
    this.icon = null;
    this.label = null;
    this.expandIcon = null;
    this.renderKey = null;
    this.hasMultipleMediaApps = null;
    this.disconnectButtonClickAction = null;
    this.desktopAppResolver = desktopAppResolver;
  }

  get extensionController() {
    return this.popupContent.extensionController;
  }
  get mediaApp() {
    return this.popupContent.mediaApp;
  }
  get popupItem() {
    return this.popupContent.popupItem;
  }
  get actor() {
    return this.container;
  }
  get interactiveActor() {
    return this.button;
  }

  render() {
    this.ensureActors();

    const hasMultipleMediaApps =
      this.extensionController.getAvailableMediaApps().length > 1;
    if (hasMultipleMediaApps !== this.hasMultipleMediaApps) {
      this.hasMultipleMediaApps = hasMultipleMediaApps;
      this.button.reactive = hasMultipleMediaApps;
      this.button.trackHover = hasMultipleMediaApps;
      this.button.canFocus = hasMultipleMediaApps;
      this.expandIcon.visible = hasMultipleMediaApps;
      if (hasMultipleMediaApps)
        this.button.add_style_class_name(StyleClasses.BUTTON);
      else this.button.remove_style_class_name(StyleClasses.BUTTON);
    }

    const identity = this.mediaApp.identity;
    const desktopEntry = this.mediaApp.desktopEntry;
    const coloredClass = this.extensionController.popupMediaAppIconUseColor
      ? StyleClasses.COLORED_ICON
      : StyleClasses.SYMBOLIC_ICON;
    const renderKey = `${this.mediaApp.busName}\u0001${identity}\u0001${desktopEntry}\u0001${coloredClass}`;
    if (renderKey !== this.renderKey) {
      const desktopApp = this.desktopAppResolver.resolveDesktopApp(
        identity,
        desktopEntry,
        this.mediaApp.busName,
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
          StyleClasses.POPUP_MENU_ICON,
          StyleClasses.POPUP_MEDIA_APP_SELECTOR_BUTTON_ICON,
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
      styleClass: StyleClasses.POPUP_MEDIA_APP_SELECTOR,
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.button = new St.BoxLayout({
      styleClass: styleClassNames(
        StyleClasses.QUICK_MENU_TOGGLE,
        StyleClasses.POPUP_MEDIA_APP_SELECTOR_BUTTON,
      ),
      xAlign: Clutter.ActorAlign.CENTER,
      reactive: true,
      trackHover: true,
    });
    this.icon = createIcon({
      styleClass: styleClassNames(
        StyleClasses.POPUP_MENU_ICON,
        StyleClasses.POPUP_MEDIA_APP_SELECTOR_BUTTON_ICON,
        StyleClasses.SYMBOLIC_ICON,
      ),
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.label = new St.Label({
      styleClass: StyleClasses.POPUP_MEDIA_APP_SELECTOR_BUTTON_LABEL,
      yAlign: Clutter.ActorAlign.CENTER,
      xAlign: Clutter.ActorAlign.CENTER,
      xExpand: true,
    });
    this.expandIcon = createIcon({
      iconName: "go-next-symbolic",
      styleClass: styleClassNames(
        StyleClasses.POPUP_MENU_ICON,
        StyleClasses.POPUP_MEDIA_APP_SELECTOR_BUTTON_EXPAND_ICON,
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
      () => this.extensionController.getAvailableMediaApps().length > 1,
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
    this.popupContent = null;
  }
}
