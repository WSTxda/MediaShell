/**
 * @file visualizer.js
 * @module shared.utils.visualizer
 *
 * Produces bounded visualizer level arrays from runtime style settings.
 *
 * TopBarVisualizer uses this pure generator to create deterministic bar heights
 * without allocating Shell actors during tests. The output is clamped so every
 * visualizer style remains within the fixed top bar drawing budget.
 */

import { TOP_BAR_VISUALIZER_SPEED } from "../constants/settings.js";
import { VisualizerStyles } from "../enums/visualizer.js";

/** Number of bars rendered by the top-bar visualizer. */
export const TOP_BAR_VISUALIZER_BAR_COUNT = 4;

const PULSE_SPEEDS = Object.freeze([1.15, 1.7, 1.35, 1.9]);

/**
 * Clamps user-configured visualizer speed to the supported settings range.
 *
 * @param {unknown} speed - Raw speed value from settings or tests.
 * @returns {number} Valid visualizer speed.
 */
export function normalizeVisualizerSpeed(speed) {
  const numericSpeed = Number(speed);
  if (!Number.isFinite(numericSpeed)) return TOP_BAR_VISUALIZER_SPEED.DEFAULT;
  return Math.min(
    TOP_BAR_VISUALIZER_SPEED.MAX,
    Math.max(TOP_BAR_VISUALIZER_SPEED.MIN, numericSpeed),
  );
}

/**
 * Generates normalized visualizer bar levels for the requested style and time.
 *
 * The function mutates `outputLevels` when a correctly sized array is supplied,
 * which lets TopBarVisualizer reuse one array per frame and avoid animation-time
 * allocations in the Shell process.
 *
 * @param {number} style - VisualizerStyles value.
 * @param {number} elapsedSeconds - Animation clock in seconds.
 * @param {number} speed - User-configured visualizer speed.
 * @param {number[]|null} outputLevels - Optional reusable output array.
 * @returns {number[]} Four values clamped to the supported visualizer level range.
 */
export function getVisualizerBarLevels(
  style,
  elapsedSeconds,
  speed = TOP_BAR_VISUALIZER_SPEED.DEFAULT,
  outputLevels = null,
) {
  const time = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
  const speedMultiplier =
    normalizeVisualizerSpeed(speed) / TOP_BAR_VISUALIZER_SPEED.DEFAULT;
  const animationTime = time * speedMultiplier;
  const levels =
    Array.isArray(outputLevels) &&
    outputLevels.length === TOP_BAR_VISUALIZER_BAR_COUNT
      ? outputLevels
      : new Array(TOP_BAR_VISUALIZER_BAR_COUNT);

  for (let index = 0; index < TOP_BAR_VISUALIZER_BAR_COUNT; index++) {
    let level;
    if (style === VisualizerStyles.PULSE) {
      const pulse =
        (Math.sin(
          animationTime * PULSE_SPEEDS[index] * Math.PI * 2 + index * 0.7,
        ) +
          1) /
        2;
      level = 0.25 + pulse * 0.75;
    } else {
      const wave =
        (Math.sin(animationTime * Math.PI * 2.2 - index * 0.95) + 1) / 2;
      level = 0.25 + wave * 0.75;
    }
    levels[index] = Math.min(1, Math.max(0.2, level));
  }

  return levels;
}
