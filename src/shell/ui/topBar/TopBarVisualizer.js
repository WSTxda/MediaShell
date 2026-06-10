// Owns a fixed-size, playback-aware visualizer composed from ordinary St actors.
import Clutter from "gi://Clutter";
import St from "gi://St";

import { PlaybackStatus, VisualizerStyles } from "../../../shared/enums/MediaShellEnums.js";
import {
    getVisualizerBarLevels,
    normalizeVisualizerSpeed,
    TOP_BAR_VISUALIZER_BAR_COUNT,
} from "../../../shared/utils/visualizer.js";

const VISUALIZER_HEIGHT = 16;
const BAR_WIDTH = 2;
const BAR_HEIGHT = 14;
const FRAME_INTERVAL_MILLISECONDS = Math.round(1000 / 30);
const TIMELINE_DURATION_MILLISECONDS = 1000;
const IDLE_LEVEL = 0.22;
const PLAYING_OPACITY = 255;
const IDLE_OPACITY = 140;

export default class TopBarVisualizer {
    constructor(topBarButton) {
        this.topBarButton = topBarButton;
        this.actor = null;
        this.bars = [];
        this.timeline = null;
        this.timelineFrameSignalId = 0;
        this.visualizerStyle = VisualizerStyles.WAVE;
        this.animationSpeed = normalizeVisualizerSpeed();
        this.playing = false;
        this.animationElapsedSeconds = 0;
        this.frameAccumulatorMilliseconds = 0;
        this.frameLevels = new Array(TOP_BAR_VISUALIZER_BAR_COUNT).fill(IDLE_LEVEL);
    }

    render(index) {
        this.ensureActor();
        this.setStyle(this.topBarButton.extensionController.topBarVisualizerStyle);
        this.setSpeed(this.topBarButton.extensionController.topBarVisualizerSpeed);
        this.setPlaying(this.topBarButton.mediaApp.playbackStatus === PlaybackStatus.PLAYING);
        this.attach(index);
    }

    ensureActor() {
        if (this.actor) return;

        this.actor = new St.BoxLayout({
            styleClass: "mediashell-top-bar-visualizer",
            orientation: Clutter.Orientation.HORIZONTAL,
            height: VISUALIZER_HEIGHT,
            opacity: IDLE_OPACITY,
            yAlign: Clutter.ActorAlign.CENTER,
            reactive: false,
        });

        this.bars = Array.from({ length: TOP_BAR_VISUALIZER_BAR_COUNT }, () => {
            const bar = new St.Widget({
                styleClass: "mediashell-top-bar-visualizer-bar",
                width: BAR_WIDTH,
                height: BAR_HEIGHT,
                yAlign: Clutter.ActorAlign.CENTER,
                reactive: false,
            });
            this.actor.add_child(bar);
            return bar;
        });

        this.timeline = Clutter.Timeline.new_for_actor(this.actor, TIMELINE_DURATION_MILLISECONDS);
        this.timeline.set_repeat_count(-1);
        this.timelineFrameSignalId = this.timeline.connect("new-frame", (timeline) => this.handleTimelineFrame(timeline));

        this.actor.connect("notify::mapped", () => this.syncAnimation());
        this.actor.connect("style-changed", () => this.syncBarColor());
        this.actor.connect("destroy", () => this.handleActorDestroyed());
        this.syncBarColor();
        this.syncBarPivots();
        this.updateFrame();
    }

    setStyle(style) {
        const normalizedStyle = Object.values(VisualizerStyles).includes(style) ? style : VisualizerStyles.WAVE;
        if (this.visualizerStyle === normalizedStyle) return;
        this.visualizerStyle = normalizedStyle;
        this.syncBarPivots();
        this.updateFrame();
    }

    setSpeed(speed) {
        const normalizedSpeed = normalizeVisualizerSpeed(speed);
        if (this.animationSpeed === normalizedSpeed) return;
        this.animationSpeed = normalizedSpeed;
        this.resetAnimationClock();
        this.updateFrame();
    }

    setPlaying(playing) {
        const normalizedPlaying = Boolean(playing);
        if (this.playing === normalizedPlaying) return;
        this.playing = normalizedPlaying;
        if (this.actor) this.actor.opacity = this.playing ? PLAYING_OPACITY : IDLE_OPACITY;
        this.resetAnimationClock();
        this.syncAnimation();
        this.updateFrame();
    }

    resetAnimationClock() {
        this.animationElapsedSeconds = 0;
        this.frameAccumulatorMilliseconds = 0;
    }

    syncBarPivots() {
        const pivotY = this.visualizerStyle === VisualizerStyles.PULSE ? 0.5 : 1;
        for (const bar of this.bars) bar.set_pivot_point(0.5, pivotY);
    }

    syncBarColor() {
        if (!this.actor) return;
        const foreground = this.actor.get_theme_node().get_foreground_color();
        const alpha = Math.max(0, Math.min(1, foreground.alpha / 255));
        const style = `background-color: rgba(${foreground.red}, ${foreground.green}, ${foreground.blue}, ${alpha});`;
        for (const bar of this.bars) bar.set_style(style);
    }

    syncAnimation() {
        const shouldAnimate = Boolean(this.actor && this.timeline && this.playing && this.actor.mapped);
        if (shouldAnimate) {
            if (!this.timeline.is_playing()) this.timeline.start();
        } else {
            this.stopAnimation();
        }
    }

    handleTimelineFrame(timeline) {
        if (!this.actor || !this.playing || !this.actor.mapped) {
            this.stopAnimation();
            return;
        }

        const deltaMilliseconds = Math.max(0, timeline.get_delta());
        this.animationElapsedSeconds += deltaMilliseconds / 1000;
        this.frameAccumulatorMilliseconds += deltaMilliseconds;
        if (this.frameAccumulatorMilliseconds < FRAME_INTERVAL_MILLISECONDS) return;

        this.frameAccumulatorMilliseconds %= FRAME_INTERVAL_MILLISECONDS;
        this.updateFrame();
    }

    stopAnimation() {
        if (!this.timeline?.is_playing()) return;
        this.timeline.stop();
    }

    updateFrame() {
        if (!this.actor) return;

        if (this.playing) {
            getVisualizerBarLevels(
                this.visualizerStyle,
                this.animationElapsedSeconds,
                this.animationSpeed,
                this.frameLevels,
            );
        } else {
            this.frameLevels?.fill(IDLE_LEVEL);
        }

        for (let index = 0; index < this.bars.length; index++) {
            const bar = this.bars[index];
            const nextScale = this.frameLevels[index];
            if (Math.abs(bar.scale_y - nextScale) > Number.EPSILON) bar.set_scale(1, nextScale);
        }
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
        this.stopAnimation();
        const actor = this.actor;
        actor.get_parent()?.remove_child(actor);
        actor.destroy();
    }

    handleActorDestroyed() {
        this.stopAnimation();
        if (this.timeline && this.timelineFrameSignalId) {
            this.timeline.disconnect(this.timelineFrameSignalId);
            this.timelineFrameSignalId = 0;
        }
        this.timeline?.set_actor(null);
        this.timeline = null;
        this.actor = null;
        this.bars = [];
        this.playing = false;
        this.resetAnimationClock();
        this.frameLevels?.fill(IDLE_LEVEL);
    }

    destroy() {
        this.remove();
        this.frameLevels = null;
        this.topBarButton = null;
    }
}
