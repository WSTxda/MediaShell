// Coordinates the top bar button, MPRIS listeners, popup ownership, and input gestures.
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";

import { InputActions, TopBarElements, PlaybackStatus, WidgetFlags } from "../../../shared/enums/MediaShellEnums.js";
import { createLogger } from "../../../shared/utils/log.js";
import PopupContent from "../popup/PopupContent.js";
import TopBarPlaybackControls from "./TopBarPlaybackControls.js";
import TopBarAppIcon from "./TopBarAppIcon.js";
import TopBarTrackInformation from "./TopBarTrackInformation.js";
import TopBarVisualizer from "./TopBarVisualizer.js";

const logger = createLogger("TopBarButton");
const APP_RESOLUTION_RETRY_MILLISECONDS = 750;
const APP_RESOLUTION_RETRY_ATTEMPTS = 4;
const MEDIA_APP_WIDGET_FLAGS = WidgetFlags.TOP_BAR | WidgetFlags.POPUP;

class TopBarButton extends PanelMenu.Button {
    constructor(mediaApp, extensionController) {
        super(0.5, "MediaShell", false);
        this.mediaApp = mediaApp;
        this.extensionController = extensionController;
        this.mediaAppPropertyListenerIds = new Map();
        this.primaryActivationTimeoutId = null;
        this.appResolutionRetrySourceId = null;
        this.appResolutionRetryAttemptsRemaining = 0;
        this.widgetUpdateSourceId = null;
        this.pendingWidgetFlags = 0;
        this.disconnectPositionChangeListener = null;
        this.destroyed = false;
        this.topBarBox = null;
        this.topBarAppIcon = new TopBarAppIcon(this);
        this.topBarTrackInformation = new TopBarTrackInformation(this);
        // The visualizer is created lazily so the disabled default owns no actor or timer.
        this.topBarVisualizer = null;
        this.topBarPlaybackControls = new TopBarPlaybackControls(this);
        this.popupContent = new PopupContent(this);
        this.addMediaAppPropertyListeners();
        this.updateWidgets(WidgetFlags.ALL);
        this.scheduleAppResolutionRetry();
        this.initializePointerActions();
        this.menu.box.add_style_class_name("mediashell-popup-container");
        this.connect("destroy", () => this.onDestroy());
    }

    vfunc_event() {
        return Clutter.EVENT_PROPAGATE;
    }

    setMediaApp(mediaApp) {
        if (this.isSameMediaApp(mediaApp)) return;
        logger.debug("Switched active media app", mediaApp.busName);
        this.removeMediaAppPropertyListeners();
        this.cancelPendingWidgetUpdate();
        this.cancelAppResolutionRetry();
        this.mediaApp = mediaApp;
        this.addMediaAppPropertyListeners();
        // The configured element order has not changed. Reconcile the new
        // app in place so feed hand-offs do not unparent and reinsert every
        // top bar actor.
        this.updateWidgets(MEDIA_APP_WIDGET_FLAGS);
        this.scheduleAppResolutionRetry();
    }

    isSameMediaApp(mediaApp) {
        return this.mediaApp.busName === mediaApp.busName;
    }

    requestWidgetUpdate(widgetFlags) {
        // MPRIS endpoints commonly emit related properties in one burst. Render
        // their combined impact once after the current main-loop turn.
        if (this.destroyed || !widgetFlags) return;
        this.pendingWidgetFlags |= widgetFlags;
        if (this.widgetUpdateSourceId !== null) return;

        this.widgetUpdateSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.widgetUpdateSourceId = null;
            const pendingWidgetFlags = this.pendingWidgetFlags;
            this.pendingWidgetFlags = 0;
            if (!this.destroyed && pendingWidgetFlags) {
                try {
                    this.updateWidgets(pendingWidgetFlags);
                } catch (error) {
                    logger.errorOnce("deferred-widget-update", "Deferred widget update failed", error);
                }
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    cancelPendingWidgetUpdate() {
        if (this.widgetUpdateSourceId !== null) {
            GLib.Source.remove(this.widgetUpdateSourceId);
            this.widgetUpdateSourceId = null;
        }
        this.pendingWidgetFlags = 0;
    }

    updateWidgets(widgetFlags) {
        if (!this.topBarBox) {
            this.topBarBox = new St.BoxLayout({ styleClass: "mediashell-top-bar-box" });
        } else if (widgetFlags & WidgetFlags.TOP_BAR_ELEMENT_ORDER) {
            this.topBarBox.remove_all_children();
        }

        let visibleIndex = 0;
        for (const elementName of this.extensionController.topBarElementOrder) {
            const element = TopBarElements[elementName];
            const isVisible = this.isTopBarElementVisible(element);
            const targetIndex = visibleIndex;
            if (
                element === TopBarElements.APP_ICON &&
                (widgetFlags & WidgetFlags.TOP_BAR_APP_ICON || widgetFlags & WidgetFlags.TOP_BAR_ELEMENT_ORDER)
            ) {
                this.runWidgetUpdate("top bar app icon", () => {
                    if (isVisible) this.topBarAppIcon.render(targetIndex);
                    else this.topBarAppIcon.remove();
                });
            }
            if (
                element === TopBarElements.TRACK_INFORMATION &&
                (widgetFlags & WidgetFlags.TOP_BAR_TRACK_INFORMATION || widgetFlags & WidgetFlags.TOP_BAR_ELEMENT_ORDER)
            ) {
                this.runWidgetUpdate("top bar track information", () => {
                    if (isVisible) this.topBarTrackInformation.render(targetIndex);
                    else this.topBarTrackInformation.remove();
                });
            }
            if (
                element === TopBarElements.VISUALIZER &&
                (widgetFlags & WidgetFlags.TOP_BAR_VISUALIZER || widgetFlags & WidgetFlags.TOP_BAR_ELEMENT_ORDER)
            ) {
                this.runWidgetUpdate("top bar visualizer", () => this.updateTopBarVisualizer(targetIndex));
            }
            if (
                element === TopBarElements.PLAYBACK_CONTROLS &&
                (widgetFlags & WidgetFlags.TOP_BAR_PLAYBACK_CONTROLS || widgetFlags & WidgetFlags.TOP_BAR_ELEMENT_ORDER)
            ) {
                this.runWidgetUpdate("top bar playback controls", () => {
                    if (isVisible) this.topBarPlaybackControls.render(targetIndex, widgetFlags);
                    else this.topBarPlaybackControls.remove();
                });
            }
            if (isVisible) visibleIndex++;
        }

        this.runWidgetUpdate("popup", () => this.popupContent.updateWidgets(widgetFlags));
        if (!this.topBarBox.get_parent()) this.add_child(this.topBarBox);
    }

    isTopBarElementVisible(element) {
        if (element === TopBarElements.APP_ICON) return this.extensionController.showTopBarAppIcon;
        if (element === TopBarElements.TRACK_INFORMATION) return this.extensionController.showTopBarTrackInformation;
        if (element === TopBarElements.VISUALIZER) return this.extensionController.showTopBarVisualizer;
        if (element === TopBarElements.PLAYBACK_CONTROLS) return this.extensionController.showTopBarPlaybackControls;
        return false;
    }

    updateTopBarVisualizer(index) {
        if (!this.extensionController.showTopBarVisualizer) {
            this.topBarVisualizer?.destroy();
            this.topBarVisualizer = null;
            return;
        }

        this.topBarVisualizer ??= new TopBarVisualizer(this);
        this.topBarVisualizer.render(index);
    }

    runWidgetUpdate(componentName, update) {
        try {
            update();
        } catch (error) {
            // Keep later components and MPRIS listeners alive even when a
            // single actor fails to render.
            logger.errorOnce(`component-update:${componentName}`, `${componentName} update failed`, error);
        }
    }

    addMediaAppPropertyListeners() {
        this.addMediaAppPropertyListener("Metadata", () => {
            this.queueMetadataWidgetUpdate();
        });
        const updateAppIdentity = () => {
            this.requestWidgetUpdate(WidgetFlags.TOP_BAR_APP_ICON | WidgetFlags.POPUP_APP_SELECTOR);
            this.scheduleAppResolutionRetry();
        };
        this.addMediaAppPropertyListener("Identity", updateAppIdentity);
        this.addMediaAppPropertyListener("DesktopEntry", updateAppIdentity);
        this.addMediaAppPropertyListener("PlaybackStatus", () => {
            this.requestWidgetUpdate(
                WidgetFlags.TOP_BAR_PLAYBACK_PLAY_PAUSE |
                    WidgetFlags.TOP_BAR_VISUALIZER |
                    WidgetFlags.POPUP_PLAYBACK_PLAY_PAUSE |
                    WidgetFlags.POPUP_PLAYBACK_PROGRESS,
            );
            if (this.mediaApp.playbackStatus !== PlaybackStatus.PLAYING) {
                this.topBarTrackInformation.pause();
                this.popupContent.pause();
            } else {
                this.topBarTrackInformation.resume();
                this.popupContent.resume();
            }
        });
        this.addMediaAppPropertyListener("CanPlay", () => {
            this.requestWidgetUpdate(WidgetFlags.TOP_BAR_PLAYBACK_PLAY_PAUSE | WidgetFlags.POPUP_PLAYBACK_PLAY_PAUSE);
        });
        this.addMediaAppPropertyListener("CanPause", () => {
            this.requestWidgetUpdate(WidgetFlags.TOP_BAR_PLAYBACK_PLAY_PAUSE | WidgetFlags.POPUP_PLAYBACK_PLAY_PAUSE);
        });
        this.addMediaAppPropertyListener("CanSeek", () => {
            this.requestWidgetUpdate(WidgetFlags.POPUP_PLAYBACK_PROGRESS);
        });
        this.addMediaAppPropertyListener("CanGoNext", () => {
            this.requestWidgetUpdate(WidgetFlags.TOP_BAR_PLAYBACK_NEXT | WidgetFlags.POPUP_PLAYBACK_NEXT);
        });
        this.addMediaAppPropertyListener("CanGoPrevious", () => {
            this.requestWidgetUpdate(WidgetFlags.TOP_BAR_PLAYBACK_PREVIOUS | WidgetFlags.POPUP_PLAYBACK_PREVIOUS);
        });
        this.addMediaAppPropertyListener("CanControl", () => {
            this.requestWidgetUpdate(WidgetFlags.TOP_BAR_PLAYBACK_CONTROLS | WidgetFlags.POPUP_PLAYBACK_CONTROLS);
        });
        this.addMediaAppPropertyListener("Shuffle", () => {
            this.requestWidgetUpdate(WidgetFlags.POPUP_PLAYBACK_SHUFFLE);
        });
        this.addMediaAppPropertyListener("LoopStatus", () => {
            this.requestWidgetUpdate(WidgetFlags.POPUP_PLAYBACK_LOOP);
        });
        this.addMediaAppPropertyListener("IsPinned", () => {
            this.requestWidgetUpdate(WidgetFlags.POPUP_APP_SELECTOR);
        });
        this.addMediaAppPropertyListener("Rate", () => {
            this.popupContent.setPlaybackRate(this.mediaApp.rate);
        });
        const observedMediaApp = this.mediaApp;
        this.disconnectPositionChangeListener = observedMediaApp.onPositionChanged((positionMicroseconds) => {
            if (this.mediaApp !== observedMediaApp) return;
            this.popupContent.setPlaybackPosition(positionMicroseconds);
        });
    }

    queueMetadataWidgetUpdate() {
        let widgetFlags = WidgetFlags.TOP_BAR_TRACK_INFORMATION;
        if (this.menu?.isOpen) {
            widgetFlags |= WidgetFlags.POPUP_ALBUM_ART | WidgetFlags.POPUP_TRACK_INFORMATION;
            if (this.extensionController.showPopupProgressBar) widgetFlags |= WidgetFlags.POPUP_PLAYBACK_PROGRESS;
        }
        // requestWidgetUpdate() already coalesces the MPRIS burst at the next idle
        // turn. A second 100 ms timer only delayed visible metadata and retained
        // this button longer without reducing same-turn work.
        this.requestWidgetUpdate(widgetFlags);
    }

    scheduleAppResolutionRetry() {
        this.cancelAppResolutionRetry();
        this.appResolutionRetryAttemptsRemaining = APP_RESOLUTION_RETRY_ATTEMPTS;

        const observedMediaApp = this.mediaApp;
        this.appResolutionRetrySourceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            APP_RESOLUTION_RETRY_MILLISECONDS,
            () => {
                if (this.destroyed || this.mediaApp !== observedMediaApp) {
                    this.appResolutionRetrySourceId = null;
                    this.appResolutionRetryAttemptsRemaining = 0;
                    return GLib.SOURCE_REMOVE;
                }

                // A resolved top bar icon proves that Shell has associated the
                // MPRIS endpoint with a desktop app. Stop polling early;
                // otherwise retry only a small, bounded number of times.
                if (this.topBarAppIcon.iconKey !== null) {
                    this.appResolutionRetrySourceId = null;
                    this.appResolutionRetryAttemptsRemaining = 0;
                    return GLib.SOURCE_REMOVE;
                }

                this.requestWidgetUpdate(WidgetFlags.TOP_BAR_APP_ICON | WidgetFlags.POPUP_APP_SELECTOR);
                this.appResolutionRetryAttemptsRemaining--;
                if (this.appResolutionRetryAttemptsRemaining <= 0) {
                    this.appResolutionRetrySourceId = null;
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    cancelAppResolutionRetry() {
        if (this.appResolutionRetrySourceId !== null) {
            GLib.Source.remove(this.appResolutionRetrySourceId);
            this.appResolutionRetrySourceId = null;
        }
        this.appResolutionRetryAttemptsRemaining = 0;
    }

    removeMediaAppPropertyListeners() {
        this.disconnectPositionChangeListener?.();
        this.disconnectPositionChangeListener = null;
        for (const [property, listenerId] of this.mediaAppPropertyListenerIds.entries()) {
            this.mediaApp.removePropertyChangeListener(property, listenerId);
        }
        this.mediaAppPropertyListenerIds.clear();
    }

    addMediaAppPropertyListener(property, callback) {
        const observedMediaApp = this.mediaApp;
        const safeCallback = () => {
            if (this.mediaApp !== observedMediaApp) return;
            try {
                callback();
            } catch (error) {
                logger.errorOnce(`mpris-listener:${property}`, `MPRIS listener failed for ${property}`, error);
            }
        };
        const listenerId = observedMediaApp.onPropertyChanged(property, safeCallback);
        this.mediaAppPropertyListenerIds.set(property, listenerId);
    }

    initializePointerActions() {
        if (typeof Clutter.ClickGesture !== "undefined") {
            // GNOME 50 replaced PanelMenu.Button's vfunc_event with a
            // Clutter.ClickGesture, so button-press-event no longer fires
            // reliably for non-primary buttons. Disable the parent's gesture
            // (which only toggles the menu on left click) and install our own
            // per-button gestures so right/middle clicks work again.
            if (this._clickGesture && typeof this._clickGesture.set_enabled === "function") {
                this._clickGesture.set_enabled(false);
            }

            this.addMouseButtonGesture(Clutter.BUTTON_PRIMARY, () => this.handlePrimaryActivation());
            this.addMouseButtonGesture(Clutter.BUTTON_MIDDLE, () => {
                const mouseAction = this.extensionController.mouseActionMiddle;
                if (mouseAction !== InputActions.NONE) {
                    this.executeMouseAction(mouseAction);
                }
            });
            this.addMouseButtonGesture(Clutter.BUTTON_SECONDARY, () => {
                const mouseAction = this.extensionController.mouseActionRight;
                if (mouseAction !== InputActions.NONE) {
                    this.executeMouseAction(mouseAction);
                }
            });
        } else {
            this.connect("button-press-event", (_, event) => {
                const mouseButton = event.get_button();

                if (mouseButton === Clutter.BUTTON_PRIMARY) {
                    this.handlePrimaryActivation();
                    return Clutter.EVENT_STOP;
                }

                let mouseAction;
                if (mouseButton === Clutter.BUTTON_MIDDLE) {
                    mouseAction = this.extensionController.mouseActionMiddle;
                } else if (mouseButton === Clutter.BUTTON_SECONDARY) {
                    mouseAction = this.extensionController.mouseActionRight;
                }

                if (mouseAction === InputActions.NONE) {
                    return Clutter.EVENT_PROPAGATE;
                }

                this.executeMouseAction(mouseAction);
                return Clutter.EVENT_STOP;
            });

            this.connect("touch-event", (_, event) => {
                const eventType = event.type();
                if (eventType === Clutter.EventType.TOUCH_BEGIN) {
                    this.handlePrimaryActivation();
                    return Clutter.EVENT_STOP;
                }

                return Clutter.EVENT_PROPAGATE;
            });
        }

        this.connect("scroll-event", (_, event) => {
            const direction = event.get_scroll_direction();
            let mouseAction = InputActions.NONE;
            if (direction === Clutter.ScrollDirection.UP) {
                mouseAction = this.extensionController.mouseActionScrollUp;
            } else if (direction === Clutter.ScrollDirection.DOWN) {
                mouseAction = this.extensionController.mouseActionScrollDown;
            }

            if (mouseAction === InputActions.NONE) return Clutter.EVENT_PROPAGATE;

            this.executeMouseAction(mouseAction);
            return Clutter.EVENT_STOP;
        });
    }

    addMouseButtonGesture(mouseButton, callback) {
        const gesture = new Clutter.ClickGesture();
        if (typeof gesture.set_required_button === "function") {
            gesture.set_required_button(mouseButton);
        }
        if (typeof gesture.set_recognize_on_press === "function") {
            gesture.set_recognize_on_press(true);
        }
        gesture.connect("recognize", () => {
            callback();
            return Clutter.EVENT_STOP;
        });
        this.add_action(gesture);
    }

    handlePrimaryActivation() {
        // Primary activation delays the single-click/tap action only when a
        // double-click/double-tap action is configured.
        if (this.extensionController.mouseActionDouble === InputActions.NONE) {
            this.executeMouseAction(this.extensionController.mouseActionLeft);
            return;
        }

        if (this.primaryActivationTimeoutId === null) {
            this.primaryActivationTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                this.primaryActivationTimeoutId = null;
                this.executeMouseAction(this.extensionController.mouseActionLeft);
                return GLib.SOURCE_REMOVE;
            });
        } else {
            GLib.Source.remove(this.primaryActivationTimeoutId);
            this.primaryActivationTimeoutId = null;
            this.executeMouseAction(this.extensionController.mouseActionDouble);
        }
    }

    executeMouseAction(mouseAction) {
        this.extensionController.executeInputAction(mouseAction);
    }

    onDestroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.removeMediaAppPropertyListeners();
        this.cancelPendingWidgetUpdate();
        this.cancelAppResolutionRetry();
        if (this.primaryActivationTimeoutId !== null) {
            GLib.Source.remove(this.primaryActivationTimeoutId);
            this.primaryActivationTimeoutId = null;
        }
        for (const [name, component] of [
            ["popupContent", this.popupContent],
            ["topBarPlaybackControls", this.topBarPlaybackControls],
            ["topBarVisualizer", this.topBarVisualizer],
            ["topBarTrackInformation", this.topBarTrackInformation],
            ["topBarAppIcon", this.topBarAppIcon],
        ]) {
            try {
                component?.destroy();
            } catch (error) {
                logger.error(`Failed to destroy ${name}`, error);
            }
            this[name] = null;
        }
        this.mediaApp = null;
        this.extensionController = null;
        this.topBarBox = null;
    }
}

export default GObject.registerClass({ GTypeName: "MediaShellTopBarButton" }, TopBarButton);
