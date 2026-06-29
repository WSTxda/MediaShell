/**
 * @file visualizer.js
 * @module shell.constants.visualizer
 *
 * Defines Shell actor geometry, timing, and opacity policy for the top bar visualizer.
 *
 * TopBarVisualizer keeps animation state local, while this file stores the fixed
 * drawing budget and frame timing that must stay consistent when visualizer
 * styles or speed settings change.
 */

/** Fixed visualizer actor height used in the compact top bar button. */
export const VISUALIZER_HEIGHT = 16;

/** Width of each visualizer bar actor. */
export const VISUALIZER_BAR_WIDTH = 2;

/** Maximum rendered height for each visualizer bar. */
export const VISUALIZER_BAR_HEIGHT = 14;

/** Base animation timeline duration before the user speed multiplier is applied. */
export const VISUALIZER_TIMELINE_DURATION_MS = 1000;

/** Bar level used when playback is idle but the visualizer remains visible. */
export const VISUALIZER_IDLE_LEVEL = 0.22;
