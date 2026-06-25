/**
 * @file PopupContent.js
 * @module shell.ui.popup.PopupContent
 *
 * Orchestrates every widget inside the MediaShell popup menu.
 *
 * PopupContent owns album art, track information, playback controls, progress,
 * and app selector components for the currently active media app. It coalesces
 * WidgetFlags into a single update cycle so bursts of MPRIS changes do not
 * rebuild the popup redundantly.
 */
import Clutter from "gi://Clutter";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { POPUP_WIDTH } from "../../../shared/constants/settings.js";
import { PlaybackStatus } from "../../../shared/enums/playback.js";
import { WidgetFlags } from "../../../shared/enums/widget.js";
import { createLogger } from "../../../shared/utils/log.js";
import { POPUP_CONTAINER_PADDING } from "../../constants/ui.js";
import PopupAlbumArt from "./PopupAlbumArt.js";
import PopupPlaybackControls from "./PopupPlaybackControls.js";
import PopupAppSelectorController from "./PopupAppSelectorController.js";
import PopupTrackInformation from "./PopupTrackInformation.js";
import PopupPlaybackProgress from "./PopupPlaybackProgress.js";

const logger = createLogger("PopupContent");

export default class PopupContent {
    constructor(topBarButton) {
        this.topBarButton = topBarButton;
        this.pendingWidgetFlags = 0;
        this.appliedPopupOuterWidth = null;
        this.popupItem = new PopupMenu.PopupBaseMenuItem({
            style_class: "no-padding mediashell-popup-box",
            activate: false,
        });
        this.popupItem.set_orientation(Clutter.Orientation.VERTICAL);
        this.popupItem.remove_style_class_name("popup-menu-item");

        this.appSelectorController = new PopupAppSelectorController(this);
        this.albumArt = new PopupAlbumArt(this);
        this.trackInformation = new PopupTrackInformation(this);
        this.playbackProgress = new PopupPlaybackProgress(this);
        this.playbackControls = new PopupPlaybackControls(this);

        this.menu.addMenuItem(this.popupItem);
        this.popupItemCapturedEventId = this.popupItem.connect("captured-event", (_actor, event) =>
            this.appSelectorController.handleCapturedEvent(event),
        );
        this.menuOpenSignalId = this.menu.connect("open-state-changed", (_menu, isOpen) => {
            if (isOpen) {
                logger.debug("Popup opened for", this.mediaApp.busName);
                let widgetFlags =
                    this.pendingWidgetFlags |
                    WidgetFlags.POPUP_APP_SELECTOR |
                    WidgetFlags.POPUP_ALBUM_ART |
                    WidgetFlags.POPUP_TRACK_INFORMATION |
                    WidgetFlags.POPUP_PLAYBACK_CONTROLS;
                if (this.extensionController.showPopupProgressBar) widgetFlags |= WidgetFlags.POPUP_PLAYBACK_PROGRESS;
                this.pendingWidgetFlags = 0;
                this.updateWidgets(widgetFlags, true);
                if (this.mediaApp.playbackStatus === PlaybackStatus.PLAYING) this.resume();
                else this.pause();
            } else {
                logger.debug("Popup closed");
                this.appSelectorController.close();
                this.albumArt.cancelAlbumArtLoad();
                this.pause();
            }
        });
    }

    get extensionController() {
        return this.topBarButton.extensionController;
    }
    get mediaApp() {
        return this.topBarButton.mediaApp;
    }
    get menu() {
        return this.topBarButton.menu;
    }

    isSameMediaApp(mediaApp) {
        return this.topBarButton.isSameMediaApp(mediaApp);
    }

    selectMediaApp(mediaApp) {
        return this.extensionController.selectMediaApp(mediaApp);
    }

    toggleMediaAppPin(mediaApp) {
        return this.extensionController.toggleMediaAppPin(mediaApp);
    }

    updateWidgets(widgetFlags, forceRender = false) {
        const popupFlags = widgetFlags & WidgetFlags.POPUP;
        if (popupFlags === 0) return;

        this.applyPopupSize();
        if (!forceRender && !this.menu.isOpen) {
            this.pendingWidgetFlags |= popupFlags;
            return;
        }

        if (popupFlags & WidgetFlags.POPUP_APP_SELECTOR) {
            this.runWidgetUpdate("app selector", () => this.appSelectorController.render());
        }

        if (popupFlags & WidgetFlags.POPUP_ALBUM_ART) {
            this.runWidgetUpdate("album art", () => {
                if (this.extensionController.showPopupAlbumArt) return this.albumArt.render();
                this.albumArt.remove();
                return null;
            });
        }

        if (popupFlags & WidgetFlags.POPUP_TRACK_INFORMATION) {
            this.runWidgetUpdate("track information", () => {
                if (this.extensionController.showPopupTrackInformation) return this.trackInformation.render();
                this.trackInformation.remove();
                return null;
            });
        }

        if (popupFlags & WidgetFlags.POPUP_PLAYBACK_PROGRESS) {
            this.runWidgetUpdate("playback progress", () => {
                if (this.extensionController.showPopupProgressBar) return this.playbackProgress.render();
                this.playbackProgress.remove();
                return null;
            });
        }

        if (popupFlags & WidgetFlags.POPUP_PLAYBACK_CONTROLS) {
            this.runWidgetUpdate("playback controls", () => this.playbackControls.render(popupFlags));
        }
    }

    runWidgetUpdate(componentName, update) {
        try {
            const result = update();
            result?.catch?.((error) =>
                logger.errorOnce(`component-update:${componentName}`, `Popup ${componentName} update failed`, error),
            );
        } catch (error) {
            // A single malformed actor or third-party metadata value must not
            // prevent the remaining popup sections from reconciling.
            logger.errorOnce(`component-update:${componentName}`, `Popup ${componentName} update failed`, error);
        }
    }

    pause() {
        this.trackInformation.pause();
        this.playbackProgress.pause();
    }

    resume() {
        this.trackInformation.resume();
        this.playbackProgress.resume();
    }

    setPlaybackRate(playbackRate) {
        this.playbackProgress.setPlaybackRate(playbackRate);
    }

    setPlaybackPosition(positionMicroseconds) {
        this.playbackProgress.setPlaybackPosition(positionMicroseconds);
    }

    buildFixedWidthStyle(width) {
        return [`width: ${width}px;`, `min-width: ${width}px;`, `max-width: ${width}px;`].join(" ");
    }

    getTrackInformationWidth() {
        return this.getPopupContentWidth();
    }

    getPopupOuterWidth() {
        return Number.isFinite(this.extensionController.popupWidth)
            ? this.extensionController.popupWidth
            : POPUP_WIDTH.DEFAULT;
    }

    getPopupContentWidth() {
        return this.getPopupOuterWidth() - POPUP_CONTAINER_PADDING * 2;
    }

    getAlbumArtWidth() {
        return this.getPopupContentWidth();
    }

    applyPopupSize() {
        if (!this.popupItem) return;

        const width = this.getPopupOuterWidth();
        if (width === this.appliedPopupOuterWidth) return;
        this.appliedPopupOuterWidth = width;
        this.popupItem.style = this.buildFixedWidthStyle(width);
        this.appSelectorController.syncAppSelectorWidth();
    }

    destroy() {
        if (!this.topBarButton) return;

        for (const [object, signalId, label] of [
            [this.menu, this.menuOpenSignalId, "menu open-state"],
            [this.popupItem, this.popupItemCapturedEventId, "popup captured-event"],
        ]) {
            if (!object || signalId === null) continue;
            try {
                object.disconnect(signalId);
            } catch {
                // The top bar actor may already be in Shell-side teardown if the
                // panel destroys the menu tree. Treat missing signal handlers or
                // disposed menu actors as successful cleanup and avoid logging a
                // misleading GObject stack trace.
                logger.debug(`${label} signal was already gone during teardown`);
            }
        }
        this.menuOpenSignalId = null;
        this.popupItemCapturedEventId = null;

        for (const property of [
            "playbackProgress",
            "trackInformation",
            "playbackControls",
            "albumArt",
            "appSelectorController",
            "popupItem",
        ]) {
            const component = this[property];
            this[property] = null;
            try {
                component?.destroy();
            } catch (error) {
                logger.error(`Failed to destroy ${property}`, error);
            }
        }
        this.pendingWidgetFlags = 0;
        this.appliedPopupOuterWidth = null;
        this.topBarButton = null;
    }
}
