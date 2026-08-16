/**
 * @file TopBarVisualizer.js
 * @module shell.ui.topBar.TopBarVisualizer
 *
 * Draws the optional top bar visualizer for the active playing media app.
 *
 * TopBarContent owns one TopBarVisualizer instance. This component owns its
 * actors, timeline, animation clock, repaint callbacks, and teardown. Style
 * definitions select local actors while stateless Cairo drawing remains in the
 * sibling drawing module without creating parallel lifecycle or settings
 * ownership.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";

import {
  TOP_BAR_VISUALIZER_BAND_COUNT,
  TOP_BAR_VISUALIZER_SPECTRUM_POINT_COUNT,
} from "../../../shared/constants/visualizer.js";
import { PlaybackStatus } from "../../../shared/enums/playback.js";
import {
  VisualizerSpectrumLayers,
  VisualizerStyles,
} from "../../../shared/enums/visualizer.js";
import {
  getVisualizerLevels,
  getVisualizerSpectrumOffsets,
  getVisualizerSpeedMultiplier,
  normalizeVisualizerSpeed,
  normalizeVisualizerStyle,
} from "../../../shared/utils/visualizer.js";
import {
  ACTIVE_OPACITY,
  INACTIVE_OPACITY,
} from "../../constants/actorState.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import {
  TOP_BAR_VISUALIZER_STYLE_DEFINITIONS,
  VISUALIZER_BAR_HEIGHT,
  VISUALIZER_BAR_WIDTH,
  VISUALIZER_CLASSIC_COLUMN_WIDTH,
  VISUALIZER_CLASSIC_SEGMENT_COUNT,
  VISUALIZER_CLASSIC_SEGMENT_HEIGHT,
  VISUALIZER_CLASSIC_UNLIT_OPACITY,
  VISUALIZER_FRAME_INTERVAL_MS,
  VISUALIZER_HEIGHT,
  VISUALIZER_IDLE_LEVEL,
  VISUALIZER_SPECTRUM_WIDTH,
  VISUALIZER_TIMELINE_DURATION_MS,
  VISUALIZER_VINYL_BASE_ROTATION_DEGREES_PER_SECOND,
  VISUALIZER_VINYL_SIZE,
  VISUALIZER_VINYL_STOP_DURATION_SECONDS,
  VisualizerRendererKinds,
} from "../../constants/visualizer.js";
import { placeActorAtIndex } from "../../utils/actors.js";
import { styleClassNames } from "../../utils/styleClasses.js";
import { drawSpectrumLayer, drawVinyl } from "./topBarVisualizerDrawing.js";

const BEATS_STYLE_DEFINITION =
  TOP_BAR_VISUALIZER_STYLE_DEFINITIONS[VisualizerStyles.BEATS];
const CLASSIC_STYLE_DEFINITION =
  TOP_BAR_VISUALIZER_STYLE_DEFINITIONS[VisualizerStyles.CLASSIC];

/**
 * Draws the optional top bar visualizer for the active playing media app.
 */
export default class TopBarVisualizer {
  constructor(topBarContent) {
    this.topBarContent = topBarContent;
    this.actor = null;
    this.continuousBars = [];
    this.classicColumns = [];
    this.spectrumArea = null;
    this.vinylArea = null;
    this.drawingColor = null;
    this.timeline = null;
    this.timelineFrameSignalId = null;
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

  get extensionController() {
    return this.topBarContent.extensionController;
  }

  get mediaApp() {
    return this.topBarContent.mediaApp;
  }

  render(index, parentBox) {
    this.ensureActor();
    this.setStyle(this.extensionController.topBarVisualizerStyle);
    this.setSpeed(this.extensionController.topBarVisualizerSpeed);
    this.setPlaying(this.mediaApp.playbackStatus === PlaybackStatus.PLAYING);
    this.attach(index, parentBox);
  }

  ensureActor() {
    if (this.actor) return;

    this.actor = new St.BoxLayout({
      styleClass: styleClassNames(
        StyleClasses.TOP_BAR_VISUALIZER,
        this.styleDefinition.containerStyleClass,
      ),
      orientation: Clutter.Orientation.HORIZONTAL,
      height: VISUALIZER_HEIGHT,
      opacity: INACTIVE_OPACITY,
      yAlign: Clutter.ActorAlign.CENTER,
      reactive: false,
    });

    this.continuousBars = Array.from(
      { length: BEATS_STYLE_DEFINITION.elementCount },
      () => {
        const bar = new St.Widget({
          styleClass: BEATS_STYLE_DEFINITION.barStyleClass,
          width: VISUALIZER_BAR_WIDTH,
          height: VISUALIZER_BAR_HEIGHT,
          yAlign: Clutter.ActorAlign.CENTER,
          reactive: false,
        });
        this.actor.add_child(bar);
        return bar;
      },
    );

    this.classicColumns = Array.from(
      { length: CLASSIC_STYLE_DEFINITION.elementCount },
      () => this.createClassicColumn(),
    );

    this.spectrumArea = new St.DrawingArea({
      width: VISUALIZER_SPECTRUM_WIDTH,
      height: VISUALIZER_HEIGHT,
      yAlign: Clutter.ActorAlign.CENTER,
      reactive: false,
      visible: false,
    });
    this.spectrumArea.connect("repaint", (area) => this.repaintSpectrum(area));
    this.actor.add_child(this.spectrumArea);

    this.vinylArea = new St.DrawingArea({
      width: VISUALIZER_VINYL_SIZE,
      height: VISUALIZER_VINYL_SIZE,
      yAlign: Clutter.ActorAlign.CENTER,
      reactive: false,
      visible: false,
    });
    this.vinylArea.set_pivot_point(0.5, 0.5);
    this.vinylArea.connect("repaint", (area) => this.repaintVinyl(area));
    this.actor.add_child(this.vinylArea);

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
    this.activateStyleRenderer();
    this.syncVisualizerColor();
    this.updateFrame();
  }

  /** Builds one bottom-filling column of rectangular Classic blocks. */
  createClassicColumn() {
    const column = new St.BoxLayout({
      styleClass: CLASSIC_STYLE_DEFINITION.columnStyleClass,
      orientation: Clutter.Orientation.VERTICAL,
      width: VISUALIZER_CLASSIC_COLUMN_WIDTH,
      yAlign: Clutter.ActorAlign.CENTER,
      reactive: false,
    });
    column.blocks = Array.from(
      { length: VISUALIZER_CLASSIC_SEGMENT_COUNT },
      () => {
        const block = new St.Widget({
          styleClass: CLASSIC_STYLE_DEFINITION.segmentStyleClass,
          width: VISUALIZER_CLASSIC_COLUMN_WIDTH,
          height: VISUALIZER_CLASSIC_SEGMENT_HEIGHT,
          reactive: false,
        });
        column.add_child(block);
        return block;
      },
    );
    this.actor.add_child(column);
    return column;
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

  /** Applies the active definition to visibility, CSS, and bar pivots. */
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
      styleClassNames(StyleClasses.TOP_BAR_VISUALIZER, containerStyleClass),
    );
    for (const bar of this.continuousBars) {
      bar.visible = continuousBarsVisible;
      if (continuousBarsVisible) {
        bar.set_style_class_name(barStyleClass);
        bar.set_pivot_point(0.5, pivotY);
      }
    }
    for (const column of this.classicColumns) column.visible = classicVisible;
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
    const style = `background-color: rgba(${foreground.red}, ${foreground.green}, ${foreground.blue}, ${alpha});`;

    for (const bar of this.continuousBars) bar.set_style(style);
    for (const column of this.classicColumns)
      for (const block of column.blocks) block.set_style(style);

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

  getVinylTargetRotationSpeed() {
    return (
      VISUALIZER_VINYL_BASE_ROTATION_DEGREES_PER_SECOND *
      getVisualizerSpeedMultiplier(this.animationSpeed)
    );
  }

  syncAnimation() {
    if (this.isVinylRendererActive() && this.actor && !this.actor.mapped)
      this.vinylRotationDegreesPerSecond = 0;

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
    if (!this.timeline?.is_playing()) return;
    this.timeline.stop();
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
      getVisualizerLevels(
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
    ) {
      this.updateClassicColumns();
    } else {
      this.updateContinuousBars();
    }
  }

  updateVinylFrame(deltaSeconds) {
    if (!this.vinylArea) return;

    const previousSpeed = this.vinylRotationDegreesPerSecond;
    let nextSpeed = previousSpeed;
    let frameSpeed = previousSpeed;

    if (this.playing) {
      nextSpeed = this.getVinylTargetRotationSpeed();
      frameSpeed = nextSpeed;
    } else if (previousSpeed > 0 && deltaSeconds > 0) {
      const deceleration =
        this.getVinylTargetRotationSpeed() /
        VISUALIZER_VINYL_STOP_DURATION_SECONDS;
      nextSpeed = Math.max(0, previousSpeed - deceleration * deltaSeconds);
      frameSpeed = (previousSpeed + nextSpeed) / 2;
    }

    if (deltaSeconds > 0 && frameSpeed > 0) {
      this.vinylAngleDegrees =
        (this.vinylAngleDegrees + frameSpeed * deltaSeconds) % 360;
      this.vinylArea.queue_repaint();
    }
    this.vinylRotationDegreesPerSecond = nextSpeed;
    this.vinylArea.set_rotation_angle(
      Clutter.RotateAxis.Z_AXIS,
      this.vinylAngleDegrees,
    );
  }

  updateContinuousBars() {
    for (let index = 0; index < this.continuousBars.length; index++) {
      const bar = this.continuousBars[index];
      const nextScale = this.animationLevels[index];
      if (Math.abs(bar.scale_y - nextScale) > Number.EPSILON)
        bar.set_scale(1, nextScale);
    }
  }

  /** Lights each Classic column from the bottom according to its sampled level. */
  updateClassicColumns() {
    for (let index = 0; index < this.classicColumns.length; index++) {
      const blocks = this.classicColumns[index].blocks;
      const activeSegments = Math.max(
        1,
        Math.min(
          VISUALIZER_CLASSIC_SEGMENT_COUNT,
          Math.round(
            this.animationLevels[index] * VISUALIZER_CLASSIC_SEGMENT_COUNT,
          ),
        ),
      );

      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const segmentFromBottom = blocks.length - blockIndex;
        const nextOpacity =
          segmentFromBottom <= activeSegments
            ? ACTIVE_OPACITY
            : VISUALIZER_CLASSIC_UNLIT_OPACITY;
        const block = blocks[blockIndex];
        if (block.opacity !== nextOpacity) block.opacity = nextOpacity;
      }
    }
  }

  updateSpectrumFrame() {
    if (this.playing) {
      getVisualizerSpectrumOffsets(
        this.animationElapsedSeconds,
        this.animationSpeed,
        this.spectrumOffsets,
        VisualizerSpectrumLayers.PRIMARY,
      );
      getVisualizerSpectrumOffsets(
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

  repaintSpectrum(area) {
    const [width, height] = area.get_surface_size();
    if (width <= 0 || height <= 0 || !this.drawingColor) return;

    const context = area.get_context();
    try {
      drawSpectrumLayer(
        context,
        this.backgroundSpectrumOffsets,
        width,
        height,
        this.drawingColor,
        INACTIVE_OPACITY / ACTIVE_OPACITY,
      );
      drawSpectrumLayer(
        context,
        this.spectrumOffsets,
        width,
        height,
        this.drawingColor,
        1,
      );
    } finally {
      context.$dispose();
    }
  }

  repaintVinyl(area) {
    const [width, height] = area.get_surface_size();
    if (width <= 0 || height <= 0 || !this.drawingColor) return;

    const context = area.get_context();
    try {
      drawVinyl(
        context,
        width,
        height,
        this.drawingColor,
        this.vinylAngleDegrees,
      );
    } finally {
      context.$dispose();
    }
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
    this.topBarContent = null;
  }
}
