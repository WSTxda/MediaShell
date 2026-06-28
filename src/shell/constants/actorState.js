/**
 * @file actorState.js
 * @module shell.constants.actorState
 *
 * Defines shared opacity values for Shell actors that represent active, inactive, or hidden state.
 *
 * Top-bar controls, popup controls, and app-selector rows import these values so
 * disabled or inactive UI feedback stays visually aligned across the extension.
 * The numbers are design policy, not behavior; checks only require centralized use.
 */

/** Fully visible opacity for active Shell actors. */
export const ACTIVE_OPACITY = 255;

/** Shared dimmed opacity for inactive controls and rows that remain visible. */
export const INACTIVE_OPACITY = 160;

/** Fully hidden opacity used before reveal animations or when actors should not draw. */
export const HIDDEN_OPACITY = 0;
