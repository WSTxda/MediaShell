/**
 * @file TopBarPlaybackControls.js
 * @module shell.ui.topBar.TopBarPlaybackControls
 *
 * Renders compact playback controls inside the top-bar button.
 *
 * TopBarButton owns this component and asks it to update button visibility and
 * sensitivity from the active PlayerProxy. The renderer consumes shared
 * PlaybackControls descriptors so popup and top-bar action names stay aligned.
 */
import Clutter from "gi://Clutter";
import St from "gi://St";

import { PlaybackStatus } from "../../../shared/enums/playback.js";
import { WidgetFlags } from "../../../shared/enums/widget.js";
import { PlaybackControls } from "../../../shared/constants/playbackControls.js";
import { createIcon, setIconName } from "../IconUtils.js";

const PLAYBACK_CONTROL_ORDER = Object.freeze([
    PlaybackControls.PREVIOUS.name,
    PlaybackControls.PLAY.name,
    PlaybackControls.NEXT.name,
]);

export default class TopBarPlaybackControls {
    constructor(topBarButton) {
        this.topBarButton = topBarButton;
        this.actor = null;
        this.controlButtons = new Map();
    }

    // widgetFlags controls which buttons need updating; no parent positioning needed
    render(widgetFlags) {
        this.ensureActor();

        if (widgetFlags & WidgetFlags.TOP_BAR_PLAYBACK_PREVIOUS) {
            this.renderOptionalControl(
                this.topBarButton.extensionController.showTopBarPreviousTrack,
                PlaybackControls.PREVIOUS,
                this.topBarButton.mediaApp.canGoPrevious && this.topBarButton.mediaApp.canControl,
                () => this.topBarButton.mediaApp.previous(),
            );
        }
        if (widgetFlags & WidgetFlags.TOP_BAR_PLAYBACK_PLAY_PAUSE) this.renderPlayPause();
        if (widgetFlags & WidgetFlags.TOP_BAR_PLAYBACK_NEXT) {
            this.renderOptionalControl(
                this.topBarButton.extensionController.showTopBarNextTrack,
                PlaybackControls.NEXT,
                this.topBarButton.mediaApp.canGoNext && this.topBarButton.mediaApp.canControl,
                () => this.topBarButton.mediaApp.next(),
            );
        }

        // Partial MPRIS updates must never use the configured absolute index of
        // one control in isolation. Reconcile the complete visible row once so
        // play/pause and capability changes cannot temporarily shuffle actors.
        this.reconcileOrder();
        this.attach();
    }

    ensureActor() {
        if (!this.actor) {
            this.actor = new St.BoxLayout({
                name: "mediashell-top-bar-playback-controls",
                styleClass: "mediashell-top-bar-playback-controls",
            });
        }
    }

    renderOptionalControl(isVisible, controlDefinition, isReactive, onClick) {
        if (isVisible) this.updatePlaybackControlIcon(controlDefinition, isReactive, onClick);
        else this.removePlaybackControlIcon(controlDefinition);
    }

    renderPlayPause() {
        if (!this.topBarButton.extensionController.showTopBarPlayPause) {
            this.removePlaybackControlIcon(PlaybackControls.PLAY);
            return;
        }

        const mediaApp = this.topBarButton.mediaApp;
        if (mediaApp.playbackStatus !== PlaybackStatus.PLAYING) {
            this.updatePlaybackControlIcon(
                PlaybackControls.PLAY,
                mediaApp.canPlay && mediaApp.canControl,
                () => mediaApp.play(),
            );
        } else if (mediaApp.canControl && !mediaApp.canPause) {
            this.updatePlaybackControlIcon(PlaybackControls.STOP, mediaApp.canControl, () => mediaApp.stop());
        } else {
            this.updatePlaybackControlIcon(
                PlaybackControls.PAUSE,
                mediaApp.canPause && mediaApp.canControl,
                () => mediaApp.pause(),
            );
        }
    }

    updatePlaybackControlIcon(controlDefinition, isReactive, onClick) {
        let control = this.controlButtons.get(controlDefinition.name);
        if (!control) {
            const button = new St.Button({
                name: controlDefinition.name,
                styleClass: "mediashell-top-bar-control-button",
                xAlign: Clutter.ActorAlign.CENTER,
                yAlign: Clutter.ActorAlign.CENTER,
                canFocus: false,
                trackHover: false,
            });
            const icon = createIcon({
                styleClass: "system-status-icon no-margin mediashell-top-bar-control-icon",
            });
            const signalId = button.connect("clicked", () => control.onClick?.());
            control = { button, icon, signalId, onClick };
            button.set_child(icon);
            this.controlButtons.set(controlDefinition.name, control);
        }

        control.onClick = onClick;
        setIconName(control.icon, controlDefinition.iconName);
        control.button.opacity = isReactive ? 255 : 160;
        control.button.reactive = isReactive;
    }

    reconcileOrder() {
        const orderedActors = PLAYBACK_CONTROL_ORDER.map((name) => this.controlButtons.get(name)?.button).filter(Boolean);

        for (let index = 0; index < orderedActors.length; index++) {
            const actor = orderedActors[index];
            const children = this.actor.get_children();
            if (children[index] === actor) continue;

            actor.get_parent()?.remove_child(actor);
            this.actor.insert_child_at_index(actor, index);
        }
    }

    removePlaybackControlIcon(controlDefinition) {
        const control = this.controlButtons.get(controlDefinition.name);
        if (!control) return;
        control.button.disconnect(control.signalId);
        control.button.get_parent()?.remove_child(control.button);
        control.button.destroy();
        control.onClick = null;
        this.controlButtons.delete(controlDefinition.name);
    }

    attach() {
        const topBarBox = this.topBarButton.topBarBox;
        const afterActionBox = this.topBarButton.topBarActionBoxAfter;
        const parent = this.actor.get_parent();
        const targetIndex = topBarBox.get_children().indexOf(afterActionBox);
        const currentIndex = parent === topBarBox ? topBarBox.get_children().indexOf(this.actor) : -1;
        if (targetIndex >= 0 && currentIndex === targetIndex - 1) return;

        parent?.remove_child(this.actor);
        const nextTargetIndex = topBarBox.get_children().indexOf(afterActionBox);
        topBarBox.insert_child_at_index(
            this.actor,
            nextTargetIndex >= 0 ? nextTargetIndex : topBarBox.get_n_children(),
        );
    }

    remove() {
        if (!this.actor) return;
        for (const name of [...this.controlButtons.keys()]) this.removePlaybackControlIcon({ name });
        this.actor.get_parent()?.remove_child(this.actor);
        this.actor.destroy();
        this.actor = null;
    }

    destroy() {
        this.remove();
        this.topBarButton = null;
    }
}
