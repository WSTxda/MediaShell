/**
 * @file PopupProgressBarSlider.js
 * @module shell.ui.popup.PopupProgressBarSlider
 *
 * Provides the popup seek slider and animated progress value.
 *
 * PopupProgressBar owns this slider and passes active media-app state into it.
 * The slider owns drag state, resume-after-drag behavior, and the Clutter
 * interval used to animate progress while playback continues.
 */

import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import St from "gi://St";

import * as Slider from "resource:///org/gnome/shell/ui/slider.js";

import { formatDurationMilliseconds } from "../../../shared/utils/format.js";
import { ACTIVE_OPACITY, INACTIVE_OPACITY } from "../../constants/actorState.js";

/**
 * Provides the popup seek slider and animated progress bar value.
 */
class PopupProgressBarSlider extends St.BoxLayout {
    constructor() {
        super({ orientation: Clutter.Orientation.VERTICAL, styleClass: "mediashell-popup-progress-bar" });
        this.playbackRate = 1;
        this.shouldResumeAfterDrag = false;
        this.isDisabled = true;
        this.lastRenderedElapsedSecond = -1;

        this.slider = new Slider.Slider(0);
        this.timeLabelsBox = new St.BoxLayout({ styleClass: "mediashell-popup-progress-bar-time" });
        this.elapsedLabel = new St.Label({
            styleClass: "mediashell-popup-progress-bar-time-label",
            text: "00:00",
            xExpand: true,
            xAlign: Clutter.ActorAlign.START,
        });
        this.trackDurationLabel = new St.Label({
            styleClass: "mediashell-popup-progress-bar-time-label",
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
        // Dragging disables the transition (isDisabled = true) and restores it on
        // button-release. Pause/resume mirror the playback state received from
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
        this.playbackTransition.set_remove_on_complete?.(false);
        this.playbackTransition.connectObject(
            "new-frame",
            (_timeline, timelineElapsedMilliseconds) => {
                this.updateElapsedTimeLabel(timelineElapsedMilliseconds * this.playbackRate);
            },
            this,
        );

        this.slider.connectObject(
            "drag-begin",
            () => {
                if (this.playbackTransition.is_playing() && !this.isDisabled) {
                    this.playbackTransition.pause();
                    this.shouldResumeAfterDrag = true;
                }
                return Clutter.EVENT_PROPAGATE;
            },
            "drag-end",
            () => {
                const requestedPositionMilliseconds =
                    this.slider.value * this.playbackTransition.duration * this.playbackRate;
                this.emit("seek-requested", Math.floor(requestedPositionMilliseconds * 1000));
                if (this.shouldResumeAfterDrag && this.get_stage() !== null) {
                    this.ensurePlaybackTransitionAttached();
                    this.playbackTransition.advance(requestedPositionMilliseconds / this.playbackRate);
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
        this.connect("destroy", () => this.onDestroy());
        this.setProgressDisabled(true);
    }

    setLayoutWidth(width) {
        this.width = width;
        this.slider.width = width;
        this.timeLabelsBox.width = width;
    }

    updateProgressBar(positionMicroseconds, durationMicroseconds, playbackRate) {
        this.playbackRate = this.normalizePlaybackRate(playbackRate);
        this.setTrackDuration(durationMicroseconds);
        this.setPlaybackPosition(positionMicroseconds);
    }

    setPlaybackRate(playbackRate) {
        const previousPlaybackRate = this.playbackRate;
        const positionMicroseconds = this.playbackTransition.get_elapsed_time() * previousPlaybackRate * 1000;
        const durationMicroseconds = this.playbackTransition.duration * previousPlaybackRate * 1000;
        this.playbackRate = this.normalizePlaybackRate(playbackRate);
        this.setTrackDuration(durationMicroseconds);
        this.setPlaybackPosition(positionMicroseconds);
    }

    normalizePlaybackRate(playbackRate) {
        return Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
    }

    setPlaybackPosition(positionMicroseconds) {
        const positionMilliseconds = Math.max(0, Number(positionMicroseconds) || 0) / 1000;
        const timelineDurationMilliseconds = Math.max(1, this.playbackTransition.duration);
        const timelinePositionMilliseconds = Math.min(
            timelineDurationMilliseconds,
            positionMilliseconds / this.playbackRate,
        );
        this.updateElapsedTimeLabel(positionMilliseconds, true);
        this.slider.value = Math.min(1, Math.max(0, timelinePositionMilliseconds / timelineDurationMilliseconds));
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
        const durationMilliseconds = Math.max(1, Number(durationMicroseconds) || 0) / 1000;
        this.trackDurationLabel.text = formatDurationMilliseconds(durationMilliseconds);
        this.playbackTransition.set_duration(Math.max(1, Math.round(durationMilliseconds / this.playbackRate)));
        this.ensurePlaybackTransitionAttached();
    }

    ensurePlaybackTransitionAttached() {
        if (this.slider.get_transition?.("progress") === null)
            this.slider.add_transition("progress", this.playbackTransition);
    }

    pausePlaybackTransition() {
        if (!this.isDisabled) this.playbackTransition.pause();
    }

    resumePlaybackTransition() {
        if (!this.isDisabled && this.get_stage() !== null && !this.playbackTransition.is_playing()) {
            this.ensurePlaybackTransitionAttached();
            this.playbackTransition.start();
        }
    }

    setProgressDisabled(isDisabled) {
        this.isDisabled = isDisabled;
        this.slider.reactive = !isDisabled;
        this.opacity = isDisabled ? INACTIVE_OPACITY : ACTIVE_OPACITY;
        if (isDisabled) {
            this.trackDurationLabel.text = "00:00";
            this.lastRenderedElapsedSecond = -1;
            this.elapsedLabel.text = "00:00";
            this.playbackTransition.set_duration(1);
            this.playbackTransition.stop();
            this.slider.value = 0;
            this.shouldResumeAfterDrag = false;
        }
    }

    onDestroy() {
        this.slider?.disconnectObject?.(this);
        this.playbackTransition?.disconnectObject?.(this);
        this.playbackTransition?.stop();
        this.slider?.remove_transition?.("progress");
        this.playbackTransition = null;
        this.slider = null;
        this.timeLabelsBox = null;
        this.elapsedLabel = null;
        this.trackDurationLabel = null;
    }
}

export default GObject.registerClass(
    {
        GTypeName: "MediaShellPopupProgressBarSlider",
        Signals: {
            "seek-requested": {
                param_types: [GObject.TYPE_INT64],
            },
        },
    },
    PopupProgressBarSlider,
);
