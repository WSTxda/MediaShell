/**
 * @file PopupProgressBarView.js
 * @module shell.ui.popup.PopupProgressBarView
 *
 * Renders the popup progress view, including seek interaction and time labels.
 *
 * PopupProgressBar owns this view and passes active media-app state into it.
 * The view owns slider interaction, elapsed/duration labels, drag state, and the
 * Clutter interval used to animate progress while playback continues.
 */

import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import St from "gi://St";

import * as Slider from "resource:///org/gnome/shell/ui/slider.js";

import { GTypeNames } from "../../../shared/constants/gtypes.js";
import { formatDurationMilliseconds } from "../../../shared/utils/format.js";
import {
  ACTIVE_OPACITY,
  INACTIVE_OPACITY,
} from "../../constants/actorState.js";
import { StyleClasses } from "../../constants/styleClasses.js";

/**
 * Renders the popup progress view and owns its local interaction state.
 */
class PopupProgressBarView extends St.BoxLayout {
  constructor() {
    super({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: StyleClasses.POPUP_PROGRESS_BAR,
    });
    this.playbackRate = 1;
    this.shouldResumeAfterDrag = false;
    this.isProgressAvailable = false;
    this.isSeekEnabled = false;
    this.lastRenderedElapsedSecond = -1;

    this.slider = new Slider.Slider(0);
    this.timeLabelsBox = new St.BoxLayout({
      styleClass: StyleClasses.POPUP_PROGRESS_BAR_TIME,
    });
    this.elapsedLabel = new St.Label({
      styleClass: StyleClasses.POPUP_PROGRESS_BAR_TIME_LABEL,
      text: "00:00",
      xExpand: true,
      xAlign: Clutter.ActorAlign.START,
    });
    this.trackDurationLabel = new St.Label({
      styleClass: StyleClasses.POPUP_PROGRESS_BAR_TIME_LABEL,
      text: "00:00",
      xExpand: true,
      xAlign: Clutter.ActorAlign.END,
    });

    // Uses Clutter.PropertyTransition to animate the slider position in real time.
    // The transition runs in GNOME Shell's animation loop so it stays frame-rate
    // aware and can be paused without a separate timer. Duration is set to the
    // remaining track length in milliseconds so the value moves from current
    // position to 1.0 at natural playback speed.
    //
    // Dragging temporarily pauses the playback transition and restores it on
    // release. Pause/resume mirror the playback state received from
    // PopupProgressBar without resetting position.
    // Keep explicit GObject.Value wrappers so Clutter.Interval receives typed values.
    const initialValue = new GObject.Value();
    initialValue.init(GObject.TYPE_DOUBLE);
    initialValue.set_double(0);
    const finalValue = new GObject.Value();
    finalValue.init(GObject.TYPE_DOUBLE);
    finalValue.set_double(1);
    this.playbackTransition = new Clutter.PropertyTransition({
      propertyName: "value",
      progressMode: Clutter.AnimationMode.LINEAR,
      repeatCount: 0,
      interval: new Clutter.Interval({
        valueType: GObject.TYPE_DOUBLE,
        initial: initialValue,
        final: finalValue,
      }),
    });
    this.playbackTransition.set_remove_on_complete(false);
    this.playbackTransition.connectObject(
      "new-frame",
      (_timeline, timelineElapsedMilliseconds) => {
        this.updateElapsedTimeLabel(
          timelineElapsedMilliseconds * this.playbackRate,
        );
      },
      this,
    );

    this.slider.connectObject(
      "drag-begin",
      () => {
        if (this.playbackTransition.is_playing() && this.isProgressAvailable) {
          this.playbackTransition.pause();
          this.shouldResumeAfterDrag = true;
        }
        return Clutter.EVENT_PROPAGATE;
      },
      "drag-end",
      () => {
        if (!this.isSeekEnabled) {
          this.shouldResumeAfterDrag = false;
          return Clutter.EVENT_PROPAGATE;
        }

        const requestedPositionMilliseconds =
          this.slider.value *
          this.playbackTransition.duration *
          this.playbackRate;
        this.emit(
          "seek-requested",
          Math.floor(requestedPositionMilliseconds * 1000),
        );
        if (this.shouldResumeAfterDrag && this.get_stage() !== null) {
          this.ensurePlaybackTransitionAttached();
          this.playbackTransition.advance(
            requestedPositionMilliseconds / this.playbackRate,
          );
          this.playbackTransition.start();
        }
        this.shouldResumeAfterDrag = false;
        return Clutter.EVENT_PROPAGATE;
      },
      "scroll-event",
      () => Clutter.EVENT_STOP,
      this,
    );

    this.timeLabelsBox.add_child(this.elapsedLabel);
    this.timeLabelsBox.add_child(this.trackDurationLabel);
    this.add_child(this.slider);
    this.add_child(this.timeLabelsBox);
    this.playbackTransition.pause();
    this.slider.add_transition("progress", this.playbackTransition);
    this.setProgressAvailable(false);
  }

  setLayoutWidth(width) {
    this.width = width;
    this.slider.width = width;
    this.timeLabelsBox.width = width;
  }

  updateProgress(positionMicroseconds, durationMicroseconds, playbackRate) {
    this.playbackRate = this.normalizePlaybackRate(playbackRate);
    this.setTrackDuration(durationMicroseconds);
    this.setPlaybackPosition(positionMicroseconds);
  }

  setPlaybackRate(playbackRate) {
    const normalizedPlaybackRate = this.normalizePlaybackRate(playbackRate);
    if (!this.isProgressAvailable) {
      this.playbackRate = normalizedPlaybackRate;
      return;
    }

    const previousPlaybackRate = this.playbackRate;
    const positionMicroseconds =
      this.playbackTransition.get_elapsed_time() * previousPlaybackRate * 1000;
    const durationMicroseconds =
      this.playbackTransition.duration * previousPlaybackRate * 1000;
    this.playbackRate = normalizedPlaybackRate;
    this.setTrackDuration(durationMicroseconds);
    this.setPlaybackPosition(positionMicroseconds);
  }

  normalizePlaybackRate(playbackRate) {
    return Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  }

  setPlaybackPosition(positionMicroseconds) {
    if (!this.isProgressAvailable) return;

    const positionMilliseconds =
      Math.max(0, Number(positionMicroseconds) || 0) / 1000;
    const timelineDurationMilliseconds = Math.max(
      1,
      this.playbackTransition.duration,
    );
    const timelinePositionMilliseconds = Math.min(
      timelineDurationMilliseconds,
      positionMilliseconds / this.playbackRate,
    );
    this.updateElapsedTimeLabel(positionMilliseconds, true);
    this.slider.value = Math.min(
      1,
      Math.max(0, timelinePositionMilliseconds / timelineDurationMilliseconds),
    );
    this.ensurePlaybackTransitionAttached();
    this.playbackTransition.advance(timelinePositionMilliseconds);
  }

  updateElapsedTimeLabel(positionMilliseconds, force = false) {
    const elapsedSecond = Math.floor(positionMilliseconds / 1000);
    if (!force && elapsedSecond === this.lastRenderedElapsedSecond) return;
    this.lastRenderedElapsedSecond = elapsedSecond;
    this.elapsedLabel.text = formatDurationMilliseconds(positionMilliseconds);
  }

  setTrackDuration(durationMicroseconds) {
    const durationMilliseconds =
      Math.max(1, Number(durationMicroseconds) || 0) / 1000;
    this.trackDurationLabel.text =
      formatDurationMilliseconds(durationMilliseconds);
    this.playbackTransition.set_duration(
      Math.max(1, Math.round(durationMilliseconds / this.playbackRate)),
    );
    this.ensurePlaybackTransitionAttached();
  }

  ensurePlaybackTransitionAttached() {
    if (this.slider.get_transition("progress") === null)
      this.slider.add_transition("progress", this.playbackTransition);
  }

  pausePlaybackTransition() {
    if (this.isProgressAvailable) this.playbackTransition.pause();
  }

  resumePlaybackTransition() {
    if (
      this.isProgressAvailable &&
      this.get_stage() !== null &&
      !this.playbackTransition.is_playing()
    ) {
      this.ensurePlaybackTransitionAttached();
      this.playbackTransition.start();
    }
  }

  setProgressAvailable(isAvailable) {
    this.isProgressAvailable = isAvailable;
    this.opacity = isAvailable ? ACTIVE_OPACITY : INACTIVE_OPACITY;
    if (isAvailable) return;

    this.setSeekEnabled(false);
    this.trackDurationLabel.text = "00:00";
    this.lastRenderedElapsedSecond = -1;
    this.elapsedLabel.text = "00:00";
    this.playbackTransition.set_duration(1);
    this.playbackTransition.stop();
    this.slider.value = 0;
    this.shouldResumeAfterDrag = false;
  }

  setSeekEnabled(isEnabled) {
    this.isSeekEnabled = isEnabled;
    this.slider.reactive = isEnabled;
    this.slider.opacity = isEnabled ? ACTIVE_OPACITY : INACTIVE_OPACITY;
    if (!isEnabled) this.shouldResumeAfterDrag = false;
  }

  destroy() {
    if (!this.slider) return;

    this.slider.disconnectObject(this);
    this.playbackTransition.disconnectObject(this);
    this.playbackTransition.stop();
    this.slider.remove_transition("progress");
    this.playbackTransition = null;
    this.slider = null;
    this.timeLabelsBox = null;
    this.elapsedLabel = null;
    this.trackDurationLabel = null;
    super.destroy();
  }
}

export default GObject.registerClass(
  {
    GTypeName: GTypeNames.POPUP_PROGRESS_BAR_VIEW,
    Signals: {
      "seek-requested": {
        param_types: [GObject.TYPE_INT64],
      },
    },
  },
  PopupProgressBarView,
);
