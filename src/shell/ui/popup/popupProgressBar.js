/**
 * @file popupProgressBar.js
 * @module shell.ui.popup.popupProgressBar
 *
 * Owns the popup progress bar section.
 *
 * PopupContent delegates elapsed/duration labels, slider visibility, and seek
 * requests to this component. The class keeps progress-specific UI updates away
 * from album art, track information, and playback control rendering.
 */

import { PlaybackStatus } from "../../mpris/protocol.js";
import { createLogger } from "../../../shared/logging/logger.js";
import { resolvePlaybackProgress } from "../../media/playback/progress.js";
import PopupProgressBarView from "./popupProgressBarView.js";

const logger = createLogger("PopupProgressBar");

/**
 * Owns the popup progress bar section.
 */
export default class PopupProgressBar {
  constructor(popupContent, playbackController) {
    this.popupContent = popupContent;
    this.playbackController = playbackController;
    this.view = null;
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
    return this.view;
  }

  getPopupContentWidth() {
    return this.popupContent.getPopupContentWidth();
  }

  setPlaybackRate(playbackRate) {
    this.view?.setPlaybackRate(playbackRate);
  }

  setPlaybackPosition(positionMicroseconds) {
    this.view?.setPlaybackPosition(positionMicroseconds);
  }

  async render() {
    const renderGeneration = ++this.positionRenderGeneration;
    const mediaApp = this.mediaApp;
    const trackDurationMicroseconds = mediaApp.track.lengthMicroseconds;
    const playbackRate = mediaApp.rate;
    const width = this.getPopupContentWidth();

    if (this.view == null) {
      this.view = new PopupProgressBarView();
      this.view.connect("seek-requested", (_, positionMicroseconds) => {
        const activeMediaApp = this.mediaApp;
        if (!activeMediaApp.canSetPosition) return;
        void this.playbackController.setPosition(
          positionMicroseconds,
          activeMediaApp,
          activeMediaApp.trackId,
        );
      });
    }

    this.view.setLayoutWidth(width);
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
    const progress = resolvePlaybackProgress(
      positionMicroseconds,
      trackDurationMicroseconds,
      playbackRate,
    );
    if (!progress) {
      this.view.setProgressAvailable(false);
      return;
    }

    this.view.setProgressAvailable(true);
    this.view.setSeekEnabled(this.mediaApp.canSetPosition);
    this.view.updateProgress(
      progress.positionMicroseconds,
      progress.durationMicroseconds,
      progress.playbackRate,
    );
    if (playbackStatus === PlaybackStatus.PLAYING)
      this.view.resumePlaybackTransition();
    else this.view.pausePlaybackTransition();
  }

  attach() {
    if (this.view.get_parent() != null) return;

    if (this.trackInformationActor?.get_parent() === this.popupItem) {
      this.popupItem.insert_child_above(this.view, this.trackInformationActor);
    } else if (this.playbackControlsActor?.get_parent() === this.popupItem) {
      this.popupItem.insert_child_below(this.view, this.playbackControlsActor);
    } else {
      this.popupItem.add_child(this.view);
    }
  }

  pause() {
    this.view?.pausePlaybackTransition();
  }

  resume() {
    this.view?.resumePlaybackTransition();
  }

  remove() {
    this.positionRenderGeneration++;
    if (!this.view) return;
    this.view.get_parent()?.remove_child(this.view);
    this.view.destroy();
    this.view = null;
  }

  destroy() {
    this.remove();
    this.playbackController = null;
    this.popupContent = null;
  }
}
