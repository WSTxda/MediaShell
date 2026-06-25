/**
 * @file PopupAppSelectorButton.js
 * @module shell.ui.popup.PopupAppSelectorButton
 *
 * Renders one selectable media-app row inside the popup app selector.
 *
 * PopupAppSelectorList creates one button per visible app and supplies the icon,
 * title, active state, and pin state. The button owns only its actor structure;
 * selection and pinning are handled by the list/controller above it.
 */
import Clutter from "gi://Clutter";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import MediaAppResolver, { FALLBACK_MEDIA_APP_ICON_NAME } from "../../services/MediaAppResolver.js";
import { createIcon, setGIcon } from "../IconUtils.js";
import { installPrimaryClickAction } from "../PointerActionUtils.js";

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

        const hasMultipleMediaApps = this.extensionController.getMediaApps().length > 1;
        if (hasMultipleMediaApps !== this.hasMultipleMediaApps) {
            this.hasMultipleMediaApps = hasMultipleMediaApps;
            this.button.reactive = hasMultipleMediaApps;
            this.button.trackHover = hasMultipleMediaApps;
            this.button.canFocus = hasMultipleMediaApps;
            this.expandIcon.visible = hasMultipleMediaApps;
            if (hasMultipleMediaApps) this.button.add_style_class_name("button");
            else this.button.remove_style_class_name("button");
        }

        const identity = this.mediaApp.identity;
        const desktopEntry = this.mediaApp.desktopEntry;
        const coloredClass = this.extensionController.useColoredPopupAppIcon ? "colored-icon" : "symbolic-icon";
        const renderKey = `${this.mediaApp.busName}\u0001${identity}\u0001${desktopEntry}\u0001${coloredClass}`;
        if (renderKey !== this.renderKey) {
            const app = this.mediaAppResolver.resolveMediaApp(identity, desktopEntry, this.mediaApp.busName);
            this.label.text = this.mediaAppResolver.getMediaAppName(app, identity || _("Unknown app"));
            setGIcon(this.icon, this.mediaAppResolver.getMediaAppIcon(app), FALLBACK_MEDIA_APP_ICON_NAME);
            this.icon.set_style_class_name(`popup-menu-icon mediashell-popup-app-selector-icon ${coloredClass}`);
            this.renderKey = app && this.mediaAppResolver.hasResolvedMediaAppIcon(app) ? renderKey : null;
        }

        if (!this.container.get_parent()) {
            this.popupItem.add_child(this.container);
        }
    }

    ensureActors() {
        if (this.container) return;

        this.container = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            styleClass: "mediashell-popup-apps",
            xAlign: Clutter.ActorAlign.CENTER,
        });
        this.button = new St.BoxLayout({
            styleClass: "quick-menu-toggle mediashell-popup-app-selector",
            xAlign: Clutter.ActorAlign.CENTER,
            reactive: true,
            trackHover: true,
        });
        this.icon = createIcon({
            styleClass: "popup-menu-icon mediashell-popup-app-selector-icon symbolic-icon",
            yAlign: Clutter.ActorAlign.CENTER,
        });
        this.label = new St.Label({
            styleClass: "mediashell-popup-app-label",
            yAlign: Clutter.ActorAlign.CENTER,
            xAlign: Clutter.ActorAlign.CENTER,
            xExpand: true,
        });
        this.expandIcon = createIcon({
            iconName: "go-next-symbolic",
            styleClass: "popup-menu-icon mediashell-popup-app-expand-icon",
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
            () => this.extensionController.getMediaApps().length > 1,
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
