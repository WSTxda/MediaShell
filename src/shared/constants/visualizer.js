/**
 * @file visualizer.js
 * @module shared.constants.visualizer
 *
 * Declares pure visualizer animation contracts and tuning parameters.
 *
 * These values are toolkit-independent and shared by animation utilities,
 * Shell renderers, and tests. Runtime actors, Cairo objects, and pixel geometry
 * remain owned by Shell-specific modules.
 */

import {
  VisualizerAnimationKinds,
  VisualizerSpectrumLayers,
} from "../enums/visualizer.js";

/** Number of frequency-like bands generated for Beats and Pulse. */
export const TOP_BAR_VISUALIZER_BAND_COUNT = 4;

/** Number of segmented columns rendered by the Classic style. */
export const TOP_BAR_VISUALIZER_CLASSIC_COLUMN_COUNT = 4;

/** Number of control points generated for each Spectrum layer. */
export const TOP_BAR_VISUALIZER_SPECTRUM_POINT_COUNT = 11;

function createLevelAnimationDefinition({
  minimumLevel,
  amplitude,
  angularFrequencyScale,
  frequencies,
  phaseOffsets,
}) {
  return Object.freeze({
    levelCount: TOP_BAR_VISUALIZER_BAND_COUNT,
    minimumLevel,
    amplitude,
    angularFrequencyScale,
    frequencies: Object.freeze(frequencies),
    phaseOffsets: Object.freeze(phaseOffsets),
  });
}

/**
 * Parameters for normalized bar-level animations.
 *
 * Beats and Pulse intentionally retain their established formulas. Classic
 * points to the Beats animation in the Shell style definition, so both render
 * the exact same frame sequence without duplicated animation parameters.
 */
export const VISUALIZER_LEVEL_ANIMATION_DEFINITIONS = Object.freeze({
  [VisualizerAnimationKinds.BEATS]: createLevelAnimationDefinition({
    minimumLevel: 0.2,
    amplitude: 0.8,
    angularFrequencyScale: Math.PI,
    frequencies: [1.5, 2.0, 2.6, 3.2],
    phaseOffsets: [0, 0.7, 1.4, 2.1],
  }),
  [VisualizerAnimationKinds.PULSE]: createLevelAnimationDefinition({
    minimumLevel: 0.25,
    amplitude: 0.75,
    angularFrequencyScale: Math.PI * 2,
    frequencies: [1.15, 1.7, 1.35, 1.9],
    phaseOffsets: [0, 0.7, 1.4, 2.1],
  }),
});

function createSpectrumBand(definition) {
  return Object.freeze(definition);
}

function createSpectrumLayer(bands) {
  return Object.freeze({ bands: Object.freeze(bands) });
}

/**
 * Refined dual-layer Spectrum animation restored from the approved source.
 *
 * Both layers share the same clock and user speed. Their independent centers,
 * widths, frequencies, phases, and amplitudes make the background trace a
 * distinct animation rather than a shifted copy of the foreground trace.
 */
export const VISUALIZER_SPECTRUM_DEFINITION = Object.freeze({
  overtoneAmplitude: 0.34,
  overtonePhaseScale: 0.6,
  overlapNormalization: 0.72,
  layers: Object.freeze({
    [VisualizerSpectrumLayers.PRIMARY]: createSpectrumLayer([
      createSpectrumBand({
        center: 0.18,
        width: 0.14,
        frequency: 0.95,
        phase: 0.2,
        amplitude: 1,
      }),
      createSpectrumBand({
        center: 0.4,
        width: 0.11,
        frequency: 1.35,
        phase: 1.6,
        amplitude: 0.9,
      }),
      createSpectrumBand({
        center: 0.62,
        width: 0.1,
        frequency: 1.75,
        phase: 3.1,
        amplitude: 0.78,
      }),
      createSpectrumBand({
        center: 0.84,
        width: 0.08,
        frequency: 2.25,
        phase: 4.5,
        amplitude: 0.6,
      }),
    ]),
    [VisualizerSpectrumLayers.SECONDARY]: createSpectrumLayer([
      createSpectrumBand({
        center: 0.3,
        width: 0.2,
        frequency: 0.55,
        phase: 1.1,
        amplitude: 0.95,
      }),
      createSpectrumBand({
        center: 0.52,
        width: 0.18,
        frequency: 0.75,
        phase: 2.4,
        amplitude: 0.85,
      }),
      createSpectrumBand({
        center: 0.74,
        width: 0.16,
        frequency: 0.95,
        phase: 3.9,
        amplitude: 0.7,
      }),
      createSpectrumBand({
        center: 0.92,
        width: 0.13,
        frequency: 1.15,
        phase: 5.2,
        amplitude: 0.5,
      }),
    ]),
  }),
});
