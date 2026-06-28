/**
 * @file TopBarTrackInformation.js
 * @module shell.ui.topBar.TopBarTrackInformation
 *
 * Renders configurable track metadata inside the GNOME top bar.
 *
 * TopBarButton owns this component and passes the ordered metadata fields chosen
 * in preferences. It uses ScrollingLabel for long text and shared metadata
 * helpers for field assembly, keeping compact top-bar layout separate from
 * metadata normalization.
 */

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { PlaybackStatus } from "../../../shared/enums/playback.js";
import { buildTrackInformationText } from "../../../shared/utils/metadata.js";
import ScrollingLabel from "../ScrollingLabel.js";

/**
 * Renders configurable track metadata inside the GNOME top bar.
 */
export default class TopBarTrackInformation {
    constructor(topBarButton) {
        this.topBarButton = topBarButton;
        this.actor = null;
        this.renderKey = null;
    }

    render(index, parentBox) {
        const text = this.buildTrackInformationText();
        const renderKey = [
            text,
            this.topBarButton.extensionController.topBarTrackInformationWidth,
            this.topBarButton.extensionController.isTopBarTrackInformationWidthLocked,
            this.topBarButton.extensionController.topBarScrollTrackInformation,
            this.topBarButton.extensionController.topBarScrollSpeed,
            this.topBarButton.extensionController.topBarScrollPauseMilliseconds,
        ].join("\u0001");

        if (this.actor && renderKey === this.renderKey) {
            this.attach(index, parentBox);
            return;
        }

        const label = new ScrollingLabel({
            text,
            width: this.topBarButton.extensionController.topBarTrackInformationWidth,
            isFixedWidth: this.topBarButton.extensionController.isTopBarTrackInformationWidthLocked,
            isScrolling: this.topBarButton.extensionController.topBarScrollTrackInformation,
            isPaused: this.topBarButton.mediaApp.playbackStatus !== PlaybackStatus.PLAYING,
            scrollSpeed: this.topBarButton.extensionController.topBarScrollSpeed,
            scrollPauseMilliseconds: this.topBarButton.extensionController.topBarScrollPauseMilliseconds,
        });

        const oldLabel = this.actor;
        this.actor = label;
        this.renderKey = renderKey;
        this.attach(index, parentBox);
        oldLabel?.destroy();
    }

    attach(index, parentBox) {
        const parent = this.actor.get_parent();
        const currentIndex = parent === parentBox ? parentBox.get_children().indexOf(this.actor) : -1;
        if (currentIndex === index) return;

        parent?.remove_child(this.actor);
        parentBox.insert_child_at_index(this.actor, index);
    }

    buildTrackInformationText() {
        return buildTrackInformationText(
            this.topBarButton.mediaApp.metadata,
            this.topBarButton.extensionController.topBarTrackInformationContent,
            {
                unknownArtist: _("Unknown artist"),
                unknownAlbum: _("Unknown album"),
            },
        );
    }

    pause() {
        this.actor?.pauseScrolling();
    }

    resume() {
        this.actor?.resumeScrolling();
    }

    remove() {
        if (!this.actor) return;
        this.actor.get_parent()?.remove_child(this.actor);
        this.actor.destroy();
        this.actor = null;
        this.renderKey = null;
    }

    destroy() {
        this.remove();
        this.topBarButton = null;
    }
}
