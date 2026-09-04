/**
 * @file presentation.js
 * @module shell.ui.components.visualizer.presentation
 *
 * Defines Shell geometry, renderer identities, and style presentation policy.
 *
 * Pure animation tuning remains in UI component definitions. This module owns only
 * pixel dimensions and the mapping from a persisted style to its Shell renderer,
 * CSS classes, pivot, and optional shared animation identity.
 */

import { MediaShellStyleClasses } from "../../style.js";
import {
  TOP_BAR_VISUALIZER_BAND_COUNT,
  TOP_BAR_VISUALIZER_CLASSIC_COLUMN_COUNT,
} from "./definitions.js";
import {
  VisualizerAnimationKinds,
  VisualizerStyles,
} from "./types.js";

/** Default visualizer actor height used in the compact top bar indicator. */
export const VISUALIZER_HEIGHT = 16;

/** Square size reserved for the slightly larger Vinyl renderer. */
export const VISUALIZER_VINYL_SIZE = 18;

/** Width of each continuous Beats or Pulse bar. */
export const VISUALIZER_BAR_WIDTH = 2;

/** Maximum rendered height for each continuous bar. */
export const VISUALIZER_BAR_HEIGHT = 14;

/** Width of each spaced Classic block column. */
export const VISUALIZER_CLASSIC_COLUMN_WIDTH = 3;

/** Number of stacked LED-style blocks in each Classic column. */
export const VISUALIZER_CLASSIC_SEGMENT_COUNT = 5;

/** Height of one Classic block. */
export const VISUALIZER_CLASSIC_SEGMENT_HEIGHT = 2;

/** Opacity applied to Classic blocks that are not currently lit. */
export const VISUALIZER_CLASSIC_UNLIT_OPACITY = 60;

/** Width of the continuous Spectrum drawing surface. */
export const VISUALIZER_SPECTRUM_WIDTH = 24;

/** Stroke width shared by both Spectrum layers. */
export const VISUALIZER_SPECTRUM_STROKE_WIDTH = 1.5;

/** Horizontal inset that keeps rounded Spectrum caps inside the surface. */
export const VISUALIZER_SPECTRUM_HORIZONTAL_PADDING =
  VISUALIZER_SPECTRUM_STROKE_WIDTH / 2;

/** Maximum vertical displacement of Spectrum layers from their center axis. */
export const VISUALIZER_SPECTRUM_AMPLITUDE = 6;

/** Base animation timeline duration before the user speed multiplier is applied. */
export const VISUALIZER_TIMELINE_DURATION_MS = 1000;

/** Minimum time between visualizer redraws, targeting 30 frames per second. */
export const VISUALIZER_FRAME_INTERVAL_MS = Math.round(1000 / 30);

/** Vinyl rotation speed at the default animation speed, in degrees per second. */
export const VISUALIZER_VINYL_BASE_ROTATION_DEGREES_PER_SECOND = 540;

/** Time taken by a playing Vinyl renderer to coast to rest after pause. */
export const VISUALIZER_VINYL_STOP_DURATION_SECONDS = 0.9;

/** Level used when playback is idle but a bar renderer remains visible. */
export const VISUALIZER_IDLE_LEVEL = 0.22;

/** Shell renderer identities used by style definitions. */
export const VisualizerRendererKinds = Object.freeze({
  CONTINUOUS_BARS: "continuous-bars",
  SEGMENTED_BARS: "segmented-bars",
  SPECTRUM: "spectrum",
  VINYL: "vinyl",
});

function createStyleDefinition(definition) {
  return Object.freeze(definition);
}

/**
 * Canonical presentation policy for every top bar visualizer style.
 *
 * Adding a style that reuses an existing animation or renderer requires one new
 * definition instead of additional conditionals across the component lifecycle.
 */
export const TOP_BAR_VISUALIZER_STYLE_DEFINITIONS = Object.freeze({
  [VisualizerStyles.BEATS]: createStyleDefinition({
    animationKind: VisualizerAnimationKinds.BEATS,
    rendererKind: VisualizerRendererKinds.CONTINUOUS_BARS,
    elementCount: TOP_BAR_VISUALIZER_BAND_COUNT,
    pivotY: 1,
    containerStyleClass: MediaShellStyleClasses.TOP_BAR_VISUALIZER_BEATS,
    barStyleClass: MediaShellStyleClasses.TOP_BAR_VISUALIZER_BEATS_BAR,
  }),
  [VisualizerStyles.PULSE]: createStyleDefinition({
    animationKind: VisualizerAnimationKinds.PULSE,
    rendererKind: VisualizerRendererKinds.CONTINUOUS_BARS,
    elementCount: TOP_BAR_VISUALIZER_BAND_COUNT,
    pivotY: 0.5,
    containerStyleClass: MediaShellStyleClasses.TOP_BAR_VISUALIZER_PULSE,
    barStyleClass: MediaShellStyleClasses.TOP_BAR_VISUALIZER_PULSE_BAR,
  }),
  [VisualizerStyles.CLASSIC]: createStyleDefinition({
    animationKind: VisualizerAnimationKinds.BEATS,
    rendererKind: VisualizerRendererKinds.SEGMENTED_BARS,
    elementCount: TOP_BAR_VISUALIZER_CLASSIC_COLUMN_COUNT,
    containerStyleClass: MediaShellStyleClasses.TOP_BAR_VISUALIZER_CLASSIC,
    columnStyleClass: MediaShellStyleClasses.TOP_BAR_VISUALIZER_CLASSIC_COLUMN,
    segmentStyleClass: MediaShellStyleClasses.TOP_BAR_VISUALIZER_CLASSIC_BLOCK,
  }),
  [VisualizerStyles.SPECTRUM]: createStyleDefinition({
    animationKind: VisualizerAnimationKinds.SPECTRUM,
    rendererKind: VisualizerRendererKinds.SPECTRUM,
    elementCount: 0,
  }),
  [VisualizerStyles.VINYL]: createStyleDefinition({
    rendererKind: VisualizerRendererKinds.VINYL,
    elementCount: 0,
  }),
});
