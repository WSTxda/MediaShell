/**
 * @file visualizer.js
 * @module shared.utils.visualizer
 *
 * Produces deterministic visualizer frames from pure animation definitions.
 *
 * Shell renderers reuse the returned arrays during playback, while style
 * presentation remains outside this module. Every animation uses the same
 * normalized user-speed multiplier and fixed playback clock.
 */

import { TOP_BAR_VISUALIZER_SPEED } from "../constants/settings.js";
import {
  TOP_BAR_VISUALIZER_SPECTRUM_POINT_COUNT,
  VISUALIZER_LEVEL_ANIMATION_DEFINITIONS,
  VISUALIZER_SPECTRUM_DEFINITION,
} from "../constants/visualizer.js";
import {
  VisualizerAnimationKinds,
  VisualizerSpectrumLayers,
  VisualizerStyles,
} from "../enums/visualizer.js";

const TAU = Math.PI * 2;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function gaussian(value, center, width) {
  const distance = (value - center) / width;
  return Math.exp(-0.5 * distance * distance);
}

function getAnimationTime(elapsedSeconds, speed) {
  const time = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
  const speedMultiplier =
    normalizeVisualizerSpeed(speed) / TOP_BAR_VISUALIZER_SPEED.DEFAULT;
  return time * speedMultiplier;
}

function fillLevelAnimation(animationTime, definition, levels) {
  for (let index = 0; index < definition.levelCount; index++) {
    const value =
      (Math.sin(
        animationTime *
          definition.frequencies[index] *
          definition.angularFrequencyScale +
          definition.phaseOffsets[index],
      ) +
        1) /
      2;
    levels[index] = clamp(
      definition.minimumLevel + value * definition.amplitude,
      definition.minimumLevel,
      1,
    );
  }
}

function fillSpectrumOffsets(animationTime, offsets, layerDefinition) {
  const lastIndex = TOP_BAR_VISUALIZER_SPECTRUM_POINT_COUNT - 1;

  for (let index = 0; index <= lastIndex; index++) {
    if (index === 0 || index === lastIndex) {
      offsets[index] = 0;
      continue;
    }

    const position = index / lastIndex;
    const edgeEnvelope = Math.sin(Math.PI * position);
    let offset = 0;
    let overlap = 0;

    for (const band of layerDefinition.bands) {
      const spatialWeight = gaussian(position, band.center, band.width);
      const fundamental = Math.sin(
        animationTime * band.frequency * TAU + band.phase,
      );
      const overtone =
        Math.sin(
          animationTime * band.frequency * 2 * TAU +
            band.phase * VISUALIZER_SPECTRUM_DEFINITION.overtonePhaseScale,
        ) * VISUALIZER_SPECTRUM_DEFINITION.overtoneAmplitude;

      offset += (fundamental + overtone) * band.amplitude * spatialWeight;
      overlap += band.amplitude * spatialWeight;
    }

    const normalization = Math.max(
      1,
      overlap * VISUALIZER_SPECTRUM_DEFINITION.overlapNormalization,
    );
    offsets[index] = clamp((offset / normalization) * edgeEnvelope, -1, 1);
  }
}

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
 * Resolves unknown persisted or runtime style values to Beats.
 *
 * @param {unknown} style - Raw VisualizerStyles value.
 * @returns {number} Supported visualizer style.
 */
export function normalizeVisualizerStyle(style) {
  return Object.values(VisualizerStyles).includes(style)
    ? style
    : VisualizerStyles.BEATS;
}

/**
 * Generates normalized levels for a bar-compatible animation.
 *
 * The function mutates `outputLevels` when it has the expected shape, allowing
 * Shell renderers to avoid per-frame allocations. Unknown animation identities
 * explicitly fall back to Beats.
 *
 * @param {string} animationKind - VisualizerAnimationKinds value.
 * @param {number} elapsedSeconds - Animation clock in seconds.
 * @param {number} speed - Shared user-configured visualizer speed.
 * @param {number[]|null} outputLevels - Optional reusable output array.
 * @returns {number[]} Normalized animation levels.
 */
export function getVisualizerLevels(
  animationKind,
  elapsedSeconds,
  speed = TOP_BAR_VISUALIZER_SPEED.DEFAULT,
  outputLevels = null,
) {
  const definition =
    VISUALIZER_LEVEL_ANIMATION_DEFINITIONS[animationKind] ??
    VISUALIZER_LEVEL_ANIMATION_DEFINITIONS[VisualizerAnimationKinds.BEATS];
  const levels =
    Array.isArray(outputLevels) && outputLevels.length === definition.levelCount
      ? outputLevels
      : new Array(definition.levelCount);

  fillLevelAnimation(
    getAnimationTime(elapsedSeconds, speed),
    definition,
    levels,
  );
  return levels;
}

/**
 * Generates signed offsets for one continuous Spectrum layer.
 *
 * Both layers use the same animation clock and speed. Each layer has its own
 * spatial and temporal band definition restored from the refined source.
 *
 * @param {number} elapsedSeconds - Animation clock in seconds.
 * @param {number} speed - Shared user-configured visualizer speed.
 * @param {number[]|null} outputOffsets - Optional reusable output array.
 * @param {string} layer - VisualizerSpectrumLayers value.
 * @returns {number[]} Signed offsets clamped from -1 to 1.
 */
export function getVisualizerSpectrumOffsets(
  elapsedSeconds,
  speed = TOP_BAR_VISUALIZER_SPEED.DEFAULT,
  outputOffsets = null,
  layer = VisualizerSpectrumLayers.PRIMARY,
) {
  const normalizedLayer =
    layer === VisualizerSpectrumLayers.SECONDARY
      ? VisualizerSpectrumLayers.SECONDARY
      : VisualizerSpectrumLayers.PRIMARY;
  const offsets =
    Array.isArray(outputOffsets) &&
    outputOffsets.length === TOP_BAR_VISUALIZER_SPECTRUM_POINT_COUNT
      ? outputOffsets
      : new Array(TOP_BAR_VISUALIZER_SPECTRUM_POINT_COUNT);

  fillSpectrumOffsets(
    getAnimationTime(elapsedSeconds, speed),
    offsets,
    VISUALIZER_SPECTRUM_DEFINITION.layers[normalizedLayer],
  );
  return offsets;
}
