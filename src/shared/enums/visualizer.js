/**
 * @file visualizer.js
 * @module shared.enums.visualizer
 *
 * Enum values for supported top bar visualizer styles.
 *
 * The preferences page stores these style IDs and TopBarVisualizer passes them
 * to the pure visualizer generator. Keeping styles in their own file prevents
 * visualizer policy from drifting into top bar placement enums.
 */

export const VisualizerStyles = Object.freeze({
  BEATS: 0,
  PULSE: 1,
});
