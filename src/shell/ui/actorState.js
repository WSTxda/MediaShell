/**
 * @file actorState.js
 * @module shell.ui.actorState
 *
 * Defines shared opacity values for active, inactive, and hidden Shell actors.
 *
 * Top bar controls, popup controls, and player-selector rows import these values so
 * disabled and inactive feedback stays visually aligned. The values are presentation
 * policy and deliberately carry no lifecycle or control semantics.
 */

/** Fully visible opacity for active Shell actors. */
export const ACTIVE_OPACITY = 255;

/** Shared dimmed opacity for inactive controls and rows that remain visible. */
export const INACTIVE_OPACITY = 160;

/** Fully hidden opacity used before reveal animations or when actors should not draw. */
export const HIDDEN_OPACITY = 0;
