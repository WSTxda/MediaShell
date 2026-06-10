// Owns the active-app selector button and its immediate colored or symbolic icon updates.
import Clutter from "gi://Clutter";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import {
    resolveMediaApp,
    getMediaAppIcon,
    getMediaAppName,
    hasResolvedMediaAppIcon,
    FALLBACK_MEDIA_APP_ICON_NAME,
} from "../../services/MediaAppResolver.js";
import { createIcon, setGIcon } from "../IconUtils.js";

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
            const app = resolveMediaApp(identity, desktopEntry, this.mediaApp.busName);
            this.label.text = getMediaAppName(app, identity || _("Unknown app"));
            setGIcon(this.icon, getMediaAppIcon(app), FALLBACK_MEDIA_APP_ICON_NAME);
            this.icon.set_style_class_name(`popup-menu-icon mediashell-popup-app-selector-icon ${coloredClass}`);
            this.renderKey = app && hasResolvedMediaAppIcon(app) ? renderKey : null;
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
        if (typeof Clutter.ClickGesture !== "undefined") {
            const clickAction = new Clutter.ClickGesture();
            clickAction.set_n_clicks_required(1);
            clickAction.set_recognize_on_press?.(true);
            clickAction.connect("recognize", () => {
                if (this.extensionController.getMediaApps().length > 1) this.onActivate?.();
                return Clutter.EVENT_STOP;
            });
            this.button.add_action(clickAction);
            return;
        }

        const clickAction = new Clutter.ClickAction();
        clickAction.connect("clicked", () => {
            if (this.extensionController.getMediaApps().length > 1) this.onActivate?.();
        });
        this.button.add_action(clickAction);
    }

    destroy() {
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
