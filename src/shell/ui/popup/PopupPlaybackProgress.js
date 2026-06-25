/**
 * @file PopupPlaybackProgress.js
 * @module shell.ui.popup.PopupPlaybackProgress
 *
 * Owns the popup progress section and live-stream replacement state.
 *
 * PopupContent delegates elapsed/duration labels and seekbar visibility to this
 * component. It switches between the slider and LIVE indicator based on normalized
 * MPRIS length and seekability while keeping seek handling in the slider child.
 */
import { PlaybackStatus } from "../../../shared/enums/playback.js";
import { createLogger } from "../../../shared/utils/log.js";
import PopupPlaybackProgressSlider from "./PopupPlaybackProgressSlider.js";

const logger = createLogger("PopupPlaybackProgress");
const MAX_REASONABLE_TRACK_DURATION_MICROSECONDS = 24 * 60 * 60 * 1000 * 1000;

export default class PopupPlaybackProgress {
    constructor(popupContent) {
        this.popupContent = popupContent;
        this.positionRenderGeneration = 0;
    }

    get mediaApp() {
        return this.popupContent.mediaApp;
    }
    get popupItem() {
        return this.popupContent.popupItem;
    }
    get trackInformationActor() {
        return this.popupContent.trackInformation.actor;
    }
    get playbackControlsActor() {
        return this.popupContent.playbackControls.actor;
    }
    get actor() {
        return this.playbackProgressSlider;
    }

    getPopupContentWidth() {
        return this.popupContent.getPopupContentWidth();
    }

    remove() {
        this.positionRenderGeneration++;
        if (!this.playbackProgressSlider) return;
        this.playbackProgressSlider.get_parent()?.remove_child(this.playbackProgressSlider);
        this.playbackProgressSlider.destroy();
        this.playbackProgressSlider = null;
    }

    setPlaybackRate(playbackRate) {
        this.playbackProgressSlider?.setPlaybackRate(playbackRate);
    }

    setPlaybackPosition(positionMicroseconds) {
        this.playbackProgressSlider?.setPlaybackPosition(positionMicroseconds);
    }

    async render() {
        const renderGeneration = ++this.positionRenderGeneration;
        const mediaApp = this.mediaApp;
        const metadata = mediaApp.metadata;
        const trackDurationMicroseconds = metadata["mpris:length"];
        const playbackRate = mediaApp.rate;
        const width = this.getPopupContentWidth();

        if (this.playbackProgressSlider == null) {
            this.playbackProgressSlider = new PopupPlaybackProgressSlider();
            this.playbackProgressSlider.connect("seek-requested", (_, positionMicroseconds) => {
                const currentMediaApp = this.mediaApp;
                currentMediaApp.setPosition(currentMediaApp.metadata["mpris:trackid"], positionMicroseconds);
            });
        }

        this.playbackProgressSlider.setLayoutWidth(width);
        this.renderPlaybackPosition(
            mediaApp.estimatedPositionMicroseconds,
            trackDurationMicroseconds,
            playbackRate,
            mediaApp.playbackStatus,
        );
        this.attach();

        const positionMicroseconds = await mediaApp.positionMicroseconds.catch((error) => {
            logger.debugOnce(
                `exact-position:${mediaApp.busName}`,
                "Could not read exact track position; keeping the estimate",
                error,
            );
            return null;
        });
        if (
            !this.popupContent ||
            renderGeneration !== this.positionRenderGeneration ||
            this.mediaApp !== mediaApp ||
            positionMicroseconds == null
        )
            return;

        this.renderPlaybackPosition(
            positionMicroseconds,
            trackDurationMicroseconds,
            mediaApp.rate,
            mediaApp.playbackStatus,
        );
    }

    renderPlaybackPosition(positionMicroseconds, trackDurationMicroseconds, playbackRate, playbackStatus) {
        const hasValidLength =
            Number.isFinite(trackDurationMicroseconds) &&
            trackDurationMicroseconds > 0 &&
            trackDurationMicroseconds < MAX_REASONABLE_TRACK_DURATION_MICROSECONDS;
        const hasValidPosition = Number.isFinite(positionMicroseconds) && positionMicroseconds >= 0;
        if (!hasValidLength || !hasValidPosition) {
            this.playbackProgressSlider.setProgressDisabled(true);
            return;
        }

        this.playbackProgressSlider.setProgressDisabled(false);
        this.playbackProgressSlider.updatePlaybackProgress(
            Math.min(positionMicroseconds, trackDurationMicroseconds),
            trackDurationMicroseconds,
            playbackRate,
        );
        if (playbackStatus === PlaybackStatus.PLAYING) this.playbackProgressSlider.resumePlaybackTransition();
        else this.playbackProgressSlider.pausePlaybackTransition();
    }

    attach() {
        if (this.playbackProgressSlider.get_parent() != null) return;

        if (this.trackInformationActor?.get_parent() === this.popupItem) {
            this.popupItem.insert_child_above(this.playbackProgressSlider, this.trackInformationActor);
        } else if (this.playbackControlsActor?.get_parent() === this.popupItem) {
            this.popupItem.insert_child_below(this.playbackProgressSlider, this.playbackControlsActor);
        } else {
            this.popupItem.add_child(this.playbackProgressSlider);
        }
    }

    pause() {
        this.playbackProgressSlider?.pausePlaybackTransition();
    }

    resume() {
        this.playbackProgressSlider?.resumePlaybackTransition();
    }

    destroy() {
        this.remove();
        this.popupContent = null;
    }
}
