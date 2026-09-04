/**
 * @file popupProgressBar.js
 * @module shell.ui.popup.popupProgressBar
 *
 * Owns the popup progress bar section.
 *
 * PopupContent delegates elapsed/duration labels, slider visibility, and seek
 * requests to this component. The class keeps progress-specific UI updates away
 * from artwork, track information, and playback control rendering.
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

  get player() {
    return this.popupContent.player;
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
    const player = this.player;
    const trackDurationMicroseconds = player.track.lengthMicroseconds;
    const playbackRate = player.rate;
    const width = this.getPopupContentWidth();

    if (this.view == null) {
      this.view = new PopupProgressBarView();
      this.view.connect("seek-requested", (_, positionMicroseconds) => {
        const activePlayer = this.player;
        if (!activePlayer.canSetPosition) return;
        void this.playbackController.setPosition(
          positionMicroseconds,
          activePlayer,
          activePlayer.trackId,
        );
      });
    }

    this.view.setLayoutWidth(width);
    this.renderPlaybackPosition(
      player.estimatedPositionMicroseconds,
      trackDurationMicroseconds,
      playbackRate,
      player.playbackStatus,
    );
    this.attach();

    const positionMicroseconds = await player.positionMicroseconds.catch(
      (error) => {
        logger.debugOnce(
          `exact-position:${player.busName}`,
          "Could not read exact track position; keeping the estimate",
          error,
        );
        return null;
      },
    );
    if (
      !this.popupContent ||
      renderGeneration !== this.positionRenderGeneration ||
      this.player !== player ||
      positionMicroseconds == null
    )
      return;

    this.renderPlaybackPosition(
      positionMicroseconds,
      trackDurationMicroseconds,
      player.rate,
      player.playbackStatus,
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
    this.view.setSeekEnabled(this.player.canSetPosition);
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
