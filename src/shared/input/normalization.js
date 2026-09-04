/**
 * @file normalization.js
 * @module shared.input.normalization
 *
 * Normalizes persisted input-action values against the executable action table.
 *
 * Shell and Preferences use this helper so deprecated or unsupported enum slots
 * fall back safely without duplicating validation policy.
 */

import { MOUSE_ACTION_VALUES } from "./actions.js";
import { InputActions } from "./types.js";

const EXECUTABLE_INPUT_ACTION_VALUES = new Set(MOUSE_ACTION_VALUES);

/** Normalizes unsupported and deprecated persisted actions to a safe fallback. */
export function normalizeInputAction(value, fallback = InputActions.NONE) {
  return EXECUTABLE_INPUT_ACTION_VALUES.has(value) ? value : fallback;
}
