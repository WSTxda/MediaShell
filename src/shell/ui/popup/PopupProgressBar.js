/**
 * @file PopupProgressBar.js
 * @module shell.ui.popup.PopupProgressBar
 *
 * Owns the popup progress bar section.
 *
 * PopupContent delegates elapsed/duration labels, slider visibility, and seek
 * requests to this component. The class keeps progress-specific UI updates away
 * from album art, track information, and playback control rendering.
 */

import { MprisMetadataKeys } from "../../../shared/constants/mpris.js";
import { PlaybackStatus } from "../../../shared/enums/playback.js";
import { createLogger } from "../../../shared/utils/log.js";
import PopupProgressBarSlider from "./PopupProgressBarSlider.js";

const logger = createLogger("PopupProgressBar");

/**
 * Owns the popup progress bar section.
 */
export default class PopupProgressBar {
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
    return this.progressBarSlider;
  }

  getPopupContentWidth() {
    return this.popupContent.getPopupContentWidth();
  }

  setPlaybackRate(playbackRate) {
    this.progressBarSlider?.setPlaybackRate(playbackRate);
  }

  setPlaybackPosition(positionMicroseconds) {
    this.progressBarSlider?.setPlaybackPosition(positionMicroseconds);
  }

  async render() {
    const renderGeneration = ++this.positionRenderGeneration;
    const mediaApp = this.mediaApp;
    const metadata = mediaApp.metadata;
    const trackDurationMicroseconds = metadata[MprisMetadataKeys.LENGTH];
    const playbackRate = mediaApp.rate;
    const width = this.getPopupContentWidth();

    if (this.progressBarSlider == null) {
      this.progressBarSlider = new PopupProgressBarSlider();
      this.progressBarSlider.connect(
        "seek-requested",
        (_, positionMicroseconds) => {
          const activeMediaApp = this.mediaApp;
          activeMediaApp.setPosition(
            activeMediaApp.metadata[MprisMetadataKeys.TRACK_ID],
            positionMicroseconds,
          );
        },
      );
    }

    this.progressBarSlider.setLayoutWidth(width);
    this.renderPlaybackPosition(
      mediaApp.estimatedPositionMicroseconds,
      trackDurationMicroseconds,
      playbackRate,
      mediaApp.playbackStatus,
    );
    this.attach();

    const positionMicroseconds = await mediaApp.positionMicroseconds.catch(
      (error) => {
        logger.debugOnce(
          `exact-position:${mediaApp.busName}`,
          "Could not read exact track position; keeping the estimate",
          error,
        );
        return null;
      },
    );
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

  renderPlaybackPosition(
    positionMicroseconds,
    trackDurationMicroseconds,
    playbackRate,
    playbackStatus,
  ) {
    const hasValidLength =
      Number.isFinite(trackDurationMicroseconds) &&
      trackDurationMicroseconds > 0 &&
      trackDurationMicroseconds <= Number.MAX_SAFE_INTEGER;
    const hasValidPosition =
      Number.isFinite(positionMicroseconds) && positionMicroseconds >= 0;
    if (!hasValidLength || !hasValidPosition) {
      this.progressBarSlider.setProgressDisabled(true);
      return;
    }

    this.progressBarSlider.setProgressDisabled(false);
    this.progressBarSlider.updateProgressBar(
      Math.min(positionMicroseconds, trackDurationMicroseconds),
      trackDurationMicroseconds,
      playbackRate,
    );
    if (playbackStatus === PlaybackStatus.PLAYING)
      this.progressBarSlider.resumePlaybackTransition();
    else this.progressBarSlider.pausePlaybackTransition();
  }

  attach() {
    if (this.progressBarSlider.get_parent() != null) return;

    if (this.trackInformationActor?.get_parent() === this.popupItem) {
      this.popupItem.insert_child_above(
        this.progressBarSlider,
        this.trackInformationActor,
      );
    } else if (this.playbackControlsActor?.get_parent() === this.popupItem) {
      this.popupItem.insert_child_below(
        this.progressBarSlider,
        this.playbackControlsActor,
      );
    } else {
      this.popupItem.add_child(this.progressBarSlider);
    }
  }

  pause() {
    this.progressBarSlider?.pausePlaybackTransition();
  }

  resume() {
    this.progressBarSlider?.resumePlaybackTransition();
  }

  remove() {
    this.positionRenderGeneration++;
    if (!this.progressBarSlider) return;
    this.progressBarSlider.get_parent()?.remove_child(this.progressBarSlider);
    this.progressBarSlider.destroy();
    this.progressBarSlider = null;
  }

  destroy() {
    this.remove();
    this.popupContent = null;
  }
}
