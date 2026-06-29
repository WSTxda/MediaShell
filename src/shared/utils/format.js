/**
 * @file format.js
 * @module shared.utils.format
 *
 * Provides formatting and normalization helpers for primitive persisted values.
 *
 * Runtime widgets use duration formatting for progress labels, while settings
 * code uses the list-normalization helpers to repair corrupted or
 * duplicated values. No GI imports are used, which keeps these helpers testable in Node.
 */

/**
 * Converts a value to a finite number or returns a fallback.
 *
 * Settings transforms use this to avoid propagating NaN, Infinity, or values
 * below the accepted minimum into Shell widgets.
 *
 * @param {unknown} value - Value to coerce.
 * @param {number} fallback - Value returned when coercion fails.
 * @param {{minimum?: number}} options - Optional lower bound.
 * @returns {number} A finite number that satisfies the minimum, or the fallback.
 */
export function finiteNumberOr(value, fallback, { minimum = -Infinity } = {}) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? number : fallback;
}

/**
 * Reads an enum value by the order used in preference combo rows.
 *
 * @param {Record<string, unknown>} enumObject - Frozen enum-like object.
 * @param {number} index - Selected combo-row index.
 * @returns {unknown} The enum value at the requested index.
 */
export function enumValueByIndex(enumObject, index) {
  return Object.values(enumObject)[index];
}

/**
 * Formats milliseconds as `MM:SS` or `HH:MM:SS` for the popup progress bar.
 *
 * Invalid or negative inputs are clamped to zero because progress labels should
 * never expose raw MPRIS timing errors to the user.
 *
 * @param {number} milliseconds - Duration or position in milliseconds.
 * @returns {string} Human-readable playback time.
 */
export function formatDurationMilliseconds(milliseconds) {
  const normalizedMilliseconds = Number.isFinite(milliseconds)
    ? Math.max(0, milliseconds)
    : 0;
  const seconds = Math.floor(normalizedMilliseconds / 1000);
  const minutes = Math.floor(normalizedMilliseconds / 60000);
  const hours = Math.floor(normalizedMilliseconds / 3600000);
  const secondsString = String(seconds % 60).padStart(2, "0");
  const minutesString = String(minutes % 60).padStart(2, "0");

  if (hours > 0)
    return `${String(hours).padStart(2, "0")}:${minutesString}:${secondsString}`;

  return `${minutesString}:${secondsString}`;
}

/**
 * Normalizes a string list by trimming, dropping empty values, and removing duplicates.
 *
 * @param {unknown[]|null|undefined} values - Raw values from settings input.
 * @returns {string[]} Stable list of unique non-empty strings.
 */
export function normalizeUniqueStrings(values) {
  const normalizedValues = [];
  const seenValues = new Set();
  for (const value of values ?? []) {
    const normalizedValue = String(value ?? "").trim();
    if (!normalizedValue || seenValues.has(normalizedValue)) continue;
    seenValues.add(normalizedValue);
    normalizedValues.push(normalizedValue);
  }
  return normalizedValues;
}

/**
 * Repairs an ordered list against an allowed-value set.
 *
 * Existing valid values keep their order, duplicates and unknown values are
 * removed, and any missing allowed values are appended. This is used for settings
 * that store user-controlled order while still needing a complete runtime list.
 *
 * @param {unknown[]|null|undefined} values - Raw ordered values.
 * @param {string[]} allowedValues - Complete allowed set in fallback order.
 * @returns {string[]} Complete normalized order.
 */
export function normalizeOrderedValues(values, allowedValues) {
  const allowedValueSet = new Set(allowedValues);
  const normalizedValues = [];
  for (const value of values ?? []) {
    if (!allowedValueSet.has(value) || normalizedValues.includes(value))
      continue;
    normalizedValues.push(value);
  }
  for (const value of allowedValues) {
    if (!normalizedValues.includes(value)) normalizedValues.push(value);
  }
  return normalizedValues;
}
