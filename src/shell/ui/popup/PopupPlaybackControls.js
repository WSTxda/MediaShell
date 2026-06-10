// Owns popup playback controls while preserving GNOME Quick Settings geometry.
import Clutter from "gi://Clutter";
import St from "gi://St";

import { LoopStatus, PlaybackStatus, WidgetFlags } from "../../../shared/enums/MediaShellEnums.js";
import { PlaybackControlDefinitions } from "../PlaybackControlDefinitions.js";
import { createIcon, setIconName } from "../IconUtils.js";

function getPopupPlaybackControlIndex(controlName) {
    if (
        controlName === PlaybackControlDefinitions.PREVIOUS.name ||
        controlName === PlaybackControlDefinitions.LOOP_NONE.name
    )
        return 0;
    if (
        controlName === PlaybackControlDefinitions.PLAY.name ||
        controlName === PlaybackControlDefinitions.SHUFFLE_ON.name
    )
        return 1;
    if (controlName === PlaybackControlDefinitions.NEXT.name) return 2;
    return 0;
}

export default class PopupPlaybackControls {
    constructor(popupContent) {
        this.popupContent = popupContent;
        this.controlButtons = new Map();
    }

    get mediaApp() {
        return this.popupContent.mediaApp;
    }
    get popupItem() {
        return this.popupContent.popupItem;
    }
    get actor() {
        return this.playbackControlsBox;
    }

    render(widgetFlags) {
        this.ensureActors();
        const mediaApp = this.mediaApp;

        if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_LOOP) {
            const loopControlDefinition =
                mediaApp.loopStatus === LoopStatus.NONE
                    ? PlaybackControlDefinitions.LOOP_NONE
                    : mediaApp.loopStatus === LoopStatus.TRACK
                      ? PlaybackControlDefinitions.LOOP_TRACK
                      : PlaybackControlDefinitions.LOOP_PLAYLIST;
            this.updatePlaybackControl(loopControlDefinition, mediaApp.canControl, () => mediaApp.toggleLoop());
        }
        if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_PREVIOUS) {
            this.updatePlaybackControl(
                PlaybackControlDefinitions.PREVIOUS,
                mediaApp.canGoPrevious && mediaApp.canControl,
                () => mediaApp.previous(),
            );
        }
        if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_PLAY_PAUSE) this.updatePlayPause(mediaApp);
        if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_NEXT) {
            this.updatePlaybackControl(PlaybackControlDefinitions.NEXT, mediaApp.canGoNext && mediaApp.canControl, () =>
                mediaApp.next(),
            );
        }
        if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_SHUFFLE) {
            this.updatePlaybackControl(
                mediaApp.shuffle ? PlaybackControlDefinitions.SHUFFLE_ON : PlaybackControlDefinitions.SHUFFLE_OFF,
                mediaApp.canControl,
                () => mediaApp.toggleShuffle(),
            );
        }

        if (!this.playbackControlsBox.get_parent()) {
            this.popupItem.add_child(this.playbackControlsBox);
        }
    }

    ensureActors() {
        if (this.playbackControlsBox) return;

        this.playbackControlsBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            styleClass: "mediashell-popup-playback-controls",
            xAlign: Clutter.ActorAlign.CENTER,
        });
        this.primaryPlaybackControlsBox = new St.BoxLayout({
            styleClass: "mediashell-popup-primary-controls",
            xAlign: Clutter.ActorAlign.CENTER,
        });
        this.secondaryPlaybackControlsBox = new St.BoxLayout({
            styleClass: "mediashell-popup-secondary-controls",
            xAlign: Clutter.ActorAlign.CENTER,
        });
        this.playbackControlsBox.add_child(this.primaryPlaybackControlsBox);
        this.playbackControlsBox.add_child(this.secondaryPlaybackControlsBox);
    }

    updatePlayPause(mediaApp) {
        if (mediaApp.playbackStatus !== PlaybackStatus.PLAYING) {
            this.updatePlaybackControl(PlaybackControlDefinitions.PLAY, mediaApp.canPlay && mediaApp.canControl, () =>
                mediaApp.play(),
            );
        } else if (mediaApp.canControl && !mediaApp.canPause) {
            this.updatePlaybackControl(PlaybackControlDefinitions.STOP, mediaApp.canControl, () => mediaApp.stop());
        } else {
            this.updatePlaybackControl(PlaybackControlDefinitions.PAUSE, mediaApp.canPause && mediaApp.canControl, () =>
                mediaApp.pause(),
            );
        }
    }

    updatePlaybackControl(controlDefinition, isReactive, onClick) {
        const controlName = controlDefinition.name;
        const isPrimaryTransport = controlName === PlaybackControlDefinitions.PLAY.name;
        const isSecondary =
            controlName === PlaybackControlDefinitions.LOOP_NONE.name ||
            controlName === PlaybackControlDefinitions.SHUFFLE_ON.name;
        const isActive =
            controlDefinition === PlaybackControlDefinitions.LOOP_TRACK ||
            controlDefinition === PlaybackControlDefinitions.LOOP_PLAYLIST ||
            controlDefinition === PlaybackControlDefinitions.SHUFFLE_ON;
        const targetControlsBox = isSecondary ? this.secondaryPlaybackControlsBox : this.primaryPlaybackControlsBox;

        let control = this.controlButtons.get(controlName);
        if (!control) {
            const styleClasses = [
                "button",
                "mediashell-popup-control-button",
                isPrimaryTransport
                    ? "mediashell-popup-control-button-primary"
                    : "mediashell-popup-control-button-circular",
                isSecondary ? "mediashell-popup-control-button-state" : "",
            ]
                .filter(Boolean)
                .join(" ");
            const button = new St.Button({
                name: controlName,
                styleClass: styleClasses,
                xAlign: Clutter.ActorAlign.CENTER,
                yAlign: Clutter.ActorAlign.CENTER,
                toggleMode: isSecondary,
            });
            const icon = createIcon({
                styleClass: "popup-menu-icon mediashell-popup-control-icon",
            });
            control = { button, icon, onClick };
            button.set_child(icon);
            button.connect("clicked", () => {
                if (control.button.reactive) control.onClick?.();
            });
            this.controlButtons.set(controlName, control);
        }

        control.onClick = onClick;
        setIconName(control.icon, controlDefinition.iconName);
        control.button.trackHover = isReactive;
        control.button.opacity = isReactive ? 255 : 160;
        control.button.reactive = isReactive;
        control.button.canFocus = isReactive;
        control.button.checked = isActive;
        this.placePlaybackControl(targetControlsBox, control.button, getPopupPlaybackControlIndex(controlName));
    }

    placePlaybackControl(targetControlsBox, button, index) {
        const children = targetControlsBox.get_children();
        const currentIndex = children.indexOf(button);
        const targetIndex = Math.min(index, children.length - (currentIndex >= 0 ? 1 : 0));
        if (currentIndex === targetIndex && button.get_parent() === targetControlsBox) return;

        button.get_parent()?.remove_child(button);
        targetControlsBox.insert_child_at_index(button, Math.max(0, targetIndex));
    }

    destroy() {
        this.playbackControlsBox?.destroy();
        this.controlButtons.clear();
        this.playbackControlsBox = null;
        this.primaryPlaybackControlsBox = null;
        this.secondaryPlaybackControlsBox = null;
        this.popupContent = null;
    }
}
