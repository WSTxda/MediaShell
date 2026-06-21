// Owns the compact playback-control row shown in the top bar.
import St from "gi://St";

import { PlaybackStatus, WidgetFlags } from "../../../shared/enums/MediaShellEnums.js";
import { PlaybackControlDefinitions } from "../PlaybackControlDefinitions.js";
import { createIcon, setIconName } from "../IconUtils.js";
import { installPrimaryClickAction } from "../PointerActionUtils.js";

const PLAYBACK_CONTROL_ORDER = Object.freeze([
    PlaybackControlDefinitions.PREVIOUS.name,
    PlaybackControlDefinitions.PLAY.name,
    PlaybackControlDefinitions.NEXT.name,
]);

export default class TopBarPlaybackControls {
    constructor(topBarButton) {
        this.topBarButton = topBarButton;
        this.actor = null;
        this.controlIcons = new Map();
    }

    render(index, widgetFlags) {
        this.ensureActor();

        if (widgetFlags & WidgetFlags.TOP_BAR_PLAYBACK_PREVIOUS) {
            this.renderOptionalControl(
                this.topBarButton.extensionController.showTopBarPreviousTrack,
                PlaybackControlDefinitions.PREVIOUS,
                this.topBarButton.mediaApp.canGoPrevious && this.topBarButton.mediaApp.canControl,
                () => this.topBarButton.mediaApp.previous(),
            );
        }
        if (widgetFlags & WidgetFlags.TOP_BAR_PLAYBACK_PLAY_PAUSE) this.renderPlayPause();
        if (widgetFlags & WidgetFlags.TOP_BAR_PLAYBACK_NEXT) {
            this.renderOptionalControl(
                this.topBarButton.extensionController.showTopBarNextTrack,
                PlaybackControlDefinitions.NEXT,
                this.topBarButton.mediaApp.canGoNext && this.topBarButton.mediaApp.canControl,
                () => this.topBarButton.mediaApp.next(),
            );
        }

        // Partial MPRIS updates must never use the configured absolute index of
        // one control in isolation. Reconcile the complete visible row once so
        // play/pause and capability changes cannot temporarily shuffle actors.
        this.reconcileOrder();
        this.attach(index);
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
            this.removePlaybackControlIcon(PlaybackControlDefinitions.PLAY);
            return;
        }

        const mediaApp = this.topBarButton.mediaApp;
        if (mediaApp.playbackStatus !== PlaybackStatus.PLAYING) {
            this.updatePlaybackControlIcon(
                PlaybackControlDefinitions.PLAY,
                mediaApp.canPlay && mediaApp.canControl,
                () => mediaApp.play(),
            );
        } else if (mediaApp.canControl && !mediaApp.canPause) {
            this.updatePlaybackControlIcon(PlaybackControlDefinitions.STOP, mediaApp.canControl, () => mediaApp.stop());
        } else {
            this.updatePlaybackControlIcon(
                PlaybackControlDefinitions.PAUSE,
                mediaApp.canPause && mediaApp.canControl,
                () => mediaApp.pause(),
            );
        }
    }

    updatePlaybackControlIcon(controlDefinition, isReactive, onClick) {
        let control = this.controlIcons.get(controlDefinition.name);
        if (!control) {
            const actor = createIcon({
                name: controlDefinition.name,
                styleClass: "system-status-icon no-margin",
            });
            control = { actor, onClick, disconnectClickAction: null };
            this.installClickAction(control);
            this.controlIcons.set(controlDefinition.name, control);
        }

        control.onClick = onClick;
        setIconName(control.actor, controlDefinition.iconName);
        control.actor.opacity = isReactive ? 255 : 160;
        control.actor.reactive = isReactive;
    }

    installClickAction(control) {
        control.disconnectClickAction = installPrimaryClickAction(
            control.actor,
            () => control.onClick?.(),
            () => control.actor.reactive,
        );
    }

    reconcileOrder() {
        const orderedActors = PLAYBACK_CONTROL_ORDER.map((name) => this.controlIcons.get(name)?.actor).filter(Boolean);

        for (let index = 0; index < orderedActors.length; index++) {
            const actor = orderedActors[index];
            const children = this.actor.get_children();
            if (children[index] === actor) continue;

            actor.get_parent()?.remove_child(actor);
            this.actor.insert_child_at_index(actor, index);
        }
    }

    removePlaybackControlIcon(controlDefinition) {
        const control = this.controlIcons.get(controlDefinition.name);
        if (!control) return;
        control.disconnectClickAction?.();
        control.disconnectClickAction = null;
        control.actor.get_parent()?.remove_child(control.actor);
        control.actor.destroy();
        control.onClick = null;
        this.controlIcons.delete(controlDefinition.name);
    }

    attach(index) {
        const topBarBox = this.topBarButton.topBarBox;
        const parent = this.actor.get_parent();
        const currentIndex = parent === topBarBox ? topBarBox.get_children().indexOf(this.actor) : -1;
        if (currentIndex === index) return;

        parent?.remove_child(this.actor);
        topBarBox.insert_child_at_index(this.actor, index);
    }

    remove() {
        if (!this.actor) return;
        for (const name of [...this.controlIcons.keys()]) this.removePlaybackControlIcon({ name });
        this.actor.get_parent()?.remove_child(this.actor);
        this.actor.destroy();
        this.actor = null;
    }

    destroy() {
        this.remove();
        this.topBarButton = null;
    }
}
