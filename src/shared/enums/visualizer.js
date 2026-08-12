/**
 * @file visualizer.js
 * @module shared.enums.visualizer
 *
 * Defines stable visualizer style IDs and reusable animation identities.
 *
 * GSettings persists the numeric style IDs, while Shell presentation maps each
 * style to a renderer and, where needed, a shared animation. Animation
 * identities remain independent so multiple styles can intentionally share the
 * same motion.
 */

/** Stable style IDs stored by the top bar visualizer preference. */
export const VisualizerStyles = Object.freeze({
  BEATS: 0,
  PULSE: 1,
  CLASSIC: 2,
  SPECTRUM: 3,
  VINYL: 4,
});

/** Pure animation identities consumed by visualizer generators and renderers. */
export const VisualizerAnimationKinds = Object.freeze({
  BEATS: "beats",
  PULSE: "pulse",
  SPECTRUM: "spectrum",
});

/** Layers drawn by the continuous Spectrum renderer. */
export const VisualizerSpectrumLayers = Object.freeze({
  PRIMARY: "primary",
  SECONDARY: "secondary",
});
