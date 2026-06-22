// Owns the scrolling track-information label and its playback-aware animation state.
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { TrackInformationFields, PlaybackStatus } from "../../../shared/enums/MediaShellEnums.js";
import { formatArtistNames } from "../../../shared/utils/metadata.js";
import ScrollingLabel from "../../helpers/ScrollingLabel.js";

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
        const metadata = this.topBarButton.mediaApp.metadata;
        const informationElements = [];
        for (const informationElement of this.topBarButton.extensionController.topBarTrackInformationContent) {
            if (TrackInformationFields[informationElement] === TrackInformationFields.TITLE) {
                informationElements.push(metadata["xesam:title"] ?? "");
            } else if (TrackInformationFields[informationElement] === TrackInformationFields.ARTIST) {
                informationElements.push(formatArtistNames(metadata["xesam:artist"], _("Unknown artist")));
            } else if (TrackInformationFields[informationElement] === TrackInformationFields.ALBUM) {
                informationElements.push(metadata["xesam:album"] || _("Unknown album"));
            } else if (TrackInformationFields[informationElement] === TrackInformationFields.DISC_NUMBER) {
                informationElements.push(metadata["xesam:discNumber"]);
            } else if (TrackInformationFields[informationElement] === TrackInformationFields.TRACK_NUMBER) {
                informationElements.push(metadata["xesam:trackNumber"]);
            } else {
                informationElements.push(informationElement);
            }
        }
        return informationElements.join(" ").replace(/[\r\n]+/g, " ");
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
