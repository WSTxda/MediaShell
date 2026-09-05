/**
 * @file topBarVisualizer.js
 * @module shell.ui.topbar.topBarVisualizer
 *
 * Owns the optional top-bar visualizer lifecycle and animation clock.
 *
 * TopBarSurface owns one instance. Renderer-specific actor construction,
 * drawing, and update policy live under ui/components/visualizer/renderers;
 * this class coordinates style selection, playback state, timeline scheduling,
 * reduced-motion policy, theme color, attachment, and teardown.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";

import { PlaybackStatus } from "../../mpris/protocol.js";
import { ACTIVE_OPACITY, INACTIVE_OPACITY } from "../actorState.js";
import {
  connectReducedMotionChanged,
  disconnectReducedMotionChanged,
  prefersReducedMotion,
} from "../accessibility/reducedMotion.js";
import { placeActorAtIndex } from "../components/actorOrder.js";
import {
  resolveVisualizerLevels,
  resolveVisualizerSpectrumOffsets,
  normalizeVisualizerSpeed,
  normalizeVisualizerStyle,
} from "../components/visualizer/animation.js";
import {
  TOP_BAR_VISUALIZER_BAND_COUNT,
  TOP_BAR_VISUALIZER_SPECTRUM_POINT_COUNT,
} from "../components/visualizer/definitions.js";
import {
  TOP_BAR_VISUALIZER_STYLE_DEFINITIONS,
  VISUALIZER_FRAME_INTERVAL_MS,
  VISUALIZER_HEIGHT,
  VISUALIZER_IDLE_LEVEL,
  VISUALIZER_TIMELINE_DURATION_MS,
  VISUALIZER_VINYL_SIZE,
  VisualizerRendererKinds,
} from "../components/visualizer/presentation.js";
import {
  configureContinuousBars,
  createContinuousBars,
  setContinuousBarsColor,
  updateContinuousBars,
} from "../components/visualizer/renderers/continuousBars.js";
import {
  createClassicColumns,
  setClassicColumnsColor,
  setClassicColumnsVisible,
  updateClassicColumns,
} from "../components/visualizer/renderers/classic.js";
import {
  createSpectrumArea,
  repaintSpectrum,
} from "../components/visualizer/renderers/spectrum.js";
import {
  createVinylArea,
  resolveVinylTargetRotationSpeed,
  repaintVinyl,
  updateVinylRotation,
} from "../components/visualizer/renderers/vinyl.js";
import {
  VisualizerSpectrumLayers,
  VisualizerStyles,
} from "../components/visualizer/types.js";
import { MediaShellStyleClasses, styleClassNames } from "../style.js";

const BEATS_STYLE_DEFINITION =
  TOP_BAR_VISUALIZER_STYLE_DEFINITIONS[VisualizerStyles.BEATS];
const CLASSIC_STYLE_DEFINITION =
  TOP_BAR_VISUALIZER_STYLE_DEFINITIONS[VisualizerStyles.CLASSIC];

/** Owns and animates the visualizer surface rendered by TopBarSurface. */
export default class TopBarVisualizer {
  constructor(topBarSurface) {
    this.topBarSurface = topBarSurface;
    this.actor = null;
    this.continuousBars = [];
    this.classicColumns = [];
    this.spectrumArea = null;
    this.vinylArea = null;
    this.drawingColor = null;
    this.timeline = null;
    this.timelineFrameSignalId = null;
    this.reducedMotionSignalId = null;
    this.visualizerStyle = VisualizerStyles.BEATS;
    this.styleDefinition = BEATS_STYLE_DEFINITION;
    this.animationSpeed = normalizeVisualizerSpeed();
    this.playing = false;
    this.animationElapsedSeconds = 0;
    this.frameAccumulatorMilliseconds = 0;
    this.vinylAngleDegrees = 0;
    this.vinylRotationDegreesPerSecond = 0;
    this.animationLevels = new Array(TOP_BAR_VISUALIZER_BAND_COUNT).fill(
      VISUALIZER_IDLE_LEVEL,
    );
    this.spectrumOffsets = new Array(
      TOP_BAR_VISUALIZER_SPECTRUM_POINT_COUNT,
    ).fill(0);
    this.backgroundSpectrumOffsets = new Array(
      TOP_BAR_VISUALIZER_SPECTRUM_POINT_COUNT,
    ).fill(0);
  }

  get settings() {
    return this.topBarSurface.settings;
  }

  get player() {
    return this.topBarSurface.player;
  }

  render(index, parentBox) {
    this.ensureActor();
    this.setStyle(this.settings.visualizerStyle);
    this.setSpeed(this.settings.visualizerSpeed);
    this.setPlaying(this.player.playbackStatus === PlaybackStatus.PLAYING);
    this.attach(index, parentBox);
  }

  ensureActor() {
    if (this.actor) return;

    this.actor = new St.BoxLayout({
      styleClass: styleClassNames(
        MediaShellStyleClasses.TOP_BAR_VISUALIZER,
        this.styleDefinition.containerStyleClass,
      ),
      orientation: Clutter.Orientation.HORIZONTAL,
      height: VISUALIZER_HEIGHT,
      opacity: INACTIVE_OPACITY,
      yAlign: Clutter.ActorAlign.CENTER,
      reactive: false,
    });

    this.continuousBars = createContinuousBars(
      this.actor,
      BEATS_STYLE_DEFINITION,
    );
    this.classicColumns = createClassicColumns(
      this.actor,
      CLASSIC_STYLE_DEFINITION,
    );
    this.spectrumArea = createSpectrumArea(this.actor, (area) =>
      repaintSpectrum(
        area,
        this.backgroundSpectrumOffsets,
        this.spectrumOffsets,
        this.drawingColor,
        INACTIVE_OPACITY / ACTIVE_OPACITY,
      ),
    );
    this.vinylArea = createVinylArea(this.actor, (area) =>
      repaintVinyl(area, this.drawingColor, this.vinylAngleDegrees),
    );

    this.timeline = Clutter.Timeline.new_for_actor(
      this.actor,
      VISUALIZER_TIMELINE_DURATION_MS,
    );
    this.timeline.set_repeat_count(-1);
    this.timelineFrameSignalId = this.timeline.connect(
      "new-frame",
      (timeline) => this.handleTimelineFrame(timeline),
    );

    this.actor.connect("notify::mapped", () => this.syncAnimation());
    this.actor.connect("style-changed", () => this.syncVisualizerColor());
    this.actor.connect("destroy", () => this.handleActorDestroyed());
    this.reducedMotionSignalId = connectReducedMotionChanged(() => {
      this.syncAnimation();
      this.updateFrame();
    });

    this.activateStyleRenderer();
    this.syncVisualizerColor();
    this.updateFrame();
  }

  setStyle(style) {
    const normalizedStyle = normalizeVisualizerStyle(style);
    if (this.visualizerStyle === normalizedStyle) return;

    this.visualizerStyle = normalizedStyle;
    this.styleDefinition =
      TOP_BAR_VISUALIZER_STYLE_DEFINITIONS[normalizedStyle];
    this.activateStyleRenderer();
    this.syncAnimation();
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
    if (this.actor)
      this.actor.opacity = this.playing ? ACTIVE_OPACITY : INACTIVE_OPACITY;
    this.resetAnimationClock();
    this.syncAnimation();
    this.updateFrame();
  }

  resetAnimationClock() {
    this.animationElapsedSeconds = 0;
    this.frameAccumulatorMilliseconds = 0;
  }

  /** Applies the active style definition without rebuilding renderer actors. */
  activateStyleRenderer() {
    if (!this.actor) return;

    const { rendererKind, containerStyleClass, barStyleClass, pivotY } =
      this.styleDefinition;
    const continuousBarsVisible =
      rendererKind === VisualizerRendererKinds.CONTINUOUS_BARS;
    const classicVisible =
      rendererKind === VisualizerRendererKinds.SEGMENTED_BARS;
    const spectrumVisible = rendererKind === VisualizerRendererKinds.SPECTRUM;
    const vinylVisible = rendererKind === VisualizerRendererKinds.VINYL;

    this.actor.set_style_class_name(
      styleClassNames(
        MediaShellStyleClasses.TOP_BAR_VISUALIZER,
        containerStyleClass,
      ),
    );
    configureContinuousBars(this.continuousBars, {
      visible: continuousBarsVisible,
      barStyleClass,
      pivotY,
    });
    setClassicColumnsVisible(this.classicColumns, classicVisible);
    this.spectrumArea.visible = spectrumVisible;
    this.vinylArea.visible = vinylVisible;
    this.actor.height = vinylVisible
      ? VISUALIZER_VINYL_SIZE
      : VISUALIZER_HEIGHT;
    if (!vinylVisible) this.vinylRotationDegreesPerSecond = 0;

    this.syncVisualizerColor();
    if (spectrumVisible) this.spectrumArea.queue_repaint();
    if (vinylVisible) this.vinylArea.queue_repaint();
  }

  syncVisualizerColor() {
    if (!this.actor) return;

    const foreground = this.actor.get_theme_node().get_foreground_color();
    const alpha = Math.max(0, Math.min(1, foreground.alpha / 255));
    const actorStyle = `background-color: rgba(${foreground.red}, ${foreground.green}, ${foreground.blue}, ${alpha});`;

    setContinuousBarsColor(this.continuousBars, actorStyle);
    setClassicColumnsColor(this.classicColumns, actorStyle);
    this.drawingColor = {
      red: foreground.red / 255,
      green: foreground.green / 255,
      blue: foreground.blue / 255,
      alpha,
    };
    this.spectrumArea?.queue_repaint();
    this.vinylArea?.queue_repaint();
  }

  isVinylRendererActive() {
    return this.styleDefinition.rendererKind === VisualizerRendererKinds.VINYL;
  }

  isVinylDecelerating() {
    return (
      this.isVinylRendererActive() &&
      !this.playing &&
      this.vinylRotationDegreesPerSecond > 0
    );
  }

  syncAnimation() {
    if (this.isVinylRendererActive() && this.actor && !this.actor.mapped)
      this.vinylRotationDegreesPerSecond = 0;

    if (prefersReducedMotion()) {
      this.stopAnimation();
      return;
    }

    const shouldAnimate = Boolean(
      this.actor &&
      this.timeline &&
      this.actor.mapped &&
      (this.playing || this.isVinylDecelerating()),
    );
    if (shouldAnimate) {
      if (!this.timeline.is_playing()) this.timeline.start();
    } else {
      this.stopAnimation();
    }
  }

  handleTimelineFrame(timeline) {
    if (!this.actor || !this.actor.mapped) {
      if (this.isVinylRendererActive()) this.vinylRotationDegreesPerSecond = 0;
      this.stopAnimation();
      return;
    }
    if (!this.playing && !this.isVinylDecelerating()) {
      this.stopAnimation();
      return;
    }

    const deltaMilliseconds = Math.max(0, timeline.get_delta());
    if (this.playing) this.animationElapsedSeconds += deltaMilliseconds / 1000;

    if (this.isVinylRendererActive()) {
      this.updateVinylFrame(deltaMilliseconds / 1000);
      if (!this.playing && !this.isVinylDecelerating()) this.stopAnimation();
      return;
    }

    this.frameAccumulatorMilliseconds += deltaMilliseconds;
    if (this.frameAccumulatorMilliseconds < VISUALIZER_FRAME_INTERVAL_MS)
      return;

    this.frameAccumulatorMilliseconds %= VISUALIZER_FRAME_INTERVAL_MS;
    this.updateFrame();
  }

  stopAnimation() {
    if (this.timeline?.is_playing()) this.timeline.stop();
  }

  updateFrame() {
    if (!this.actor) return;

    if (this.isVinylRendererActive()) {
      this.updateVinylFrame(0);
      return;
    }

    if (
      this.styleDefinition.rendererKind === VisualizerRendererKinds.SPECTRUM
    ) {
      this.updateSpectrumFrame();
      return;
    }

    if (this.playing) {
      resolveVisualizerLevels(
        this.styleDefinition.animationKind,
        this.animationElapsedSeconds,
        this.animationSpeed,
        this.animationLevels,
      );
    } else {
      this.animationLevels.fill(VISUALIZER_IDLE_LEVEL);
    }

    if (
      this.styleDefinition.rendererKind ===
      VisualizerRendererKinds.SEGMENTED_BARS
    )
      updateClassicColumns(this.classicColumns, this.animationLevels);
    else updateContinuousBars(this.continuousBars, this.animationLevels);
  }

  updateVinylFrame(deltaSeconds) {
    if (!this.vinylArea) return;

    const nextState = updateVinylRotation({
      area: this.vinylArea,
      playing: this.playing,
      previousSpeed: this.vinylRotationDegreesPerSecond,
      targetSpeed: resolveVinylTargetRotationSpeed(this.animationSpeed),
      angleDegrees: this.vinylAngleDegrees,
      deltaSeconds,
    });
    this.vinylAngleDegrees = nextState.angleDegrees;
    this.vinylRotationDegreesPerSecond = nextState.rotationDegreesPerSecond;
  }

  updateSpectrumFrame() {
    if (this.playing) {
      resolveVisualizerSpectrumOffsets(
        this.animationElapsedSeconds,
        this.animationSpeed,
        this.spectrumOffsets,
        VisualizerSpectrumLayers.PRIMARY,
      );
      resolveVisualizerSpectrumOffsets(
        this.animationElapsedSeconds,
        this.animationSpeed,
        this.backgroundSpectrumOffsets,
        VisualizerSpectrumLayers.SECONDARY,
      );
    } else {
      this.spectrumOffsets.fill(0);
      this.backgroundSpectrumOffsets.fill(0);
    }
    this.spectrumArea?.queue_repaint();
  }

  attach(index, parentBox) {
    placeActorAtIndex(this.actor, parentBox, index);
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
    if (this.timeline && this.timelineFrameSignalId !== null) {
      this.timeline.disconnect(this.timelineFrameSignalId);
      this.timelineFrameSignalId = null;
    }
    disconnectReducedMotionChanged(this.reducedMotionSignalId);
    this.reducedMotionSignalId = null;
    this.timeline?.set_actor(null);
    this.timeline = null;
    this.actor = null;
    this.continuousBars = [];
    this.classicColumns = [];
    this.spectrumArea = null;
    this.vinylArea = null;
    this.drawingColor = null;
    this.playing = false;
    this.vinylAngleDegrees = 0;
    this.vinylRotationDegreesPerSecond = 0;
    this.resetAnimationClock();
    this.animationLevels?.fill(VISUALIZER_IDLE_LEVEL);
    this.spectrumOffsets?.fill(0);
    this.backgroundSpectrumOffsets?.fill(0);
  }

  destroy() {
    this.remove();
    this.animationLevels = null;
    this.spectrumOffsets = null;
    this.backgroundSpectrumOffsets = null;
    this.topBarSurface = null;
  }
}
