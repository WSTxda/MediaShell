/**
 * @file visualizer.js
 * @module shared.constants.visualizer
 *
 * Defines visualizer contracts shared by pure animation math and Shell rendering.
 *
 * The bar count determines both the reusable level-array shape and the number
 * of Shell actors rendered in the top bar, so it belongs at the shared boundary
 * instead of either implementation module.
 */

/** Number of level values and Shell bar actors in the top bar visualizer. */
export const TOP_BAR_VISUALIZER_BAR_COUNT = 4;

/** Relative pulse rates applied to the shared visualizer bars. */
export const VISUALIZER_PULSE_SPEEDS = Object.freeze([1.15, 1.7, 1.35, 1.9]);

/** Beat frequencies used by the pure visualizer level generator. */
export const VISUALIZER_BEAT_FREQUENCIES = Object.freeze([1.5, 2.0, 2.6, 3.2]);

/** Phase offsets that keep beat bars from moving in lockstep. */
export const VISUALIZER_BEAT_PHASES = Object.freeze([0, 0.7, 1.4, 2.1]);
