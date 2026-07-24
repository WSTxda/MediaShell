/**
 * @file PopupAppSelectorButton.js
 * @module shell.ui.popup.PopupAppSelectorButton
 *
 * Renders the popup app-selector trigger for the active media app.
 *
 * The trigger displays the active media app and opens PopupAppSelectorList when
 * multiple media apps are available. It owns its actors and click action; row
 * selection and pinning remain the list/controller responsibility.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { IconNames } from "../../../shared/constants/icons.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import MediaAppResolver from "../../services/MediaAppResolver.js";
import { createIcon, setGIcon } from "../../utils/icons.js";
import { installPrimaryClickAction } from "../../utils/pointerActions.js";
import { styleClassNames } from "../../utils/styleClasses.js";

/**
 * Renders the popup app-selector trigger for the active media app.
 */
export default class PopupAppSelectorButton {
  constructor(popupContent, onActivate) {
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
    this.mediaAppResolver = MediaAppResolver.getInstance();
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
    const coloredClass = this.extensionController.popupAppIconUseColor
      ? StyleClasses.COLORED_ICON
      : StyleClasses.SYMBOLIC_ICON;
    const renderKey = `${this.mediaApp.busName}\u0001${identity}\u0001${desktopEntry}\u0001${coloredClass}`;
    if (renderKey !== this.renderKey) {
      const app = this.mediaAppResolver.resolveMediaApp(
        identity,
        desktopEntry,
        this.mediaApp.busName,
      );
      this.label.text = this.mediaAppResolver.getMediaAppName(
        app,
        identity || _("Unknown app"),
      );
      setGIcon(
        this.icon,
        this.mediaAppResolver.getMediaAppIcon(app),
        IconNames.MEDIA,
      );
      this.icon.set_style_class_name(
        styleClassNames(
          StyleClasses.POPUP_MENU_ICON,
          StyleClasses.POPUP_APP_SELECTOR_TRIGGER_ICON,
          coloredClass,
        ),
      );
      this.renderKey =
        app && this.mediaAppResolver.hasResolvedMediaAppIcon(app)
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
      styleClass: StyleClasses.POPUP_APP_SELECTOR_CONTAINER,
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.button = new St.BoxLayout({
      styleClass: styleClassNames(
        StyleClasses.QUICK_MENU_TOGGLE,
        StyleClasses.POPUP_APP_SELECTOR_TRIGGER,
      ),
      xAlign: Clutter.ActorAlign.CENTER,
      reactive: true,
      trackHover: true,
    });
    this.icon = createIcon({
      styleClass: styleClassNames(
        StyleClasses.POPUP_MENU_ICON,
        StyleClasses.POPUP_APP_SELECTOR_TRIGGER_ICON,
        StyleClasses.SYMBOLIC_ICON,
      ),
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.label = new St.Label({
      styleClass: StyleClasses.POPUP_APP_SELECTOR_TRIGGER_LABEL,
      yAlign: Clutter.ActorAlign.CENTER,
      xAlign: Clutter.ActorAlign.CENTER,
      xExpand: true,
    });
    this.expandIcon = createIcon({
      iconName: "go-next-symbolic",
      styleClass: styleClassNames(
        StyleClasses.POPUP_MENU_ICON,
        StyleClasses.POPUP_APP_SELECTOR_TRIGGER_EXPAND_ICON,
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
    this.onActivate = null;
    this.popupContent = null;
  }
}
