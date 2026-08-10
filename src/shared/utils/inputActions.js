/**
 * @file inputActions.js
 * @module shared.utils.inputActions
 *
 * Normalizes persisted input-action values against the executable action table.
 *
 * Shell and Preferences use this helper so deprecated or unsupported enum slots
 * fall back safely without duplicating validation policy.
 */

import { MOUSE_ACTION_VALUES } from "../constants/inputActions.js";
import { InputActions } from "../enums/input.js";

const EXECUTABLE_INPUT_ACTION_VALUES = new Set(MOUSE_ACTION_VALUES);

/** Normalizes unsupported and deprecated persisted actions to a safe fallback. */
export function normalizeInputAction(value, fallback = InputActions.NONE) {
  return EXECUTABLE_INPUT_ACTION_VALUES.has(value) ? value : fallback;
}
