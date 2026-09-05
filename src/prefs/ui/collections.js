/**
 * @file collections.js
 * @module prefs.ui.collections
 *
 * Provides collection helpers owned by the Preferences process.
 *
 * Reorderable preference widgets use the same index rules so drag-and-drop
 * behavior cannot drift between top bar elements and track-information content.
 */

/**
 * Returns whether two arrays contain the same values in the same order.
 *
 * @param {unknown[]} first - First array.
 * @param {unknown[]} second - Second array.
 * @returns {boolean} True when both arrays are shallowly equal.
 */
export function arraysEqual(first, second) {
  return (
    Array.isArray(first) &&
    Array.isArray(second) &&
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

/**
 * Moves one item inside an array without changing the array identity.
 *
 * @param {unknown[]} values - Mutable array to reorder.
 * @param {number} sourceIndex - Current item index.
 * @param {number} targetIndex - Requested final item index.
 * @returns {boolean} True only when a valid move changed the array.
 */
export function moveArrayItem(values, sourceIndex, targetIndex) {
  if (
    !Array.isArray(values) ||
    !Number.isInteger(sourceIndex) ||
    !Number.isInteger(targetIndex) ||
    sourceIndex < 0 ||
    targetIndex < 0 ||
    sourceIndex >= values.length ||
    targetIndex >= values.length ||
    sourceIndex === targetIndex
  )
    return false;

  const [value] = values.splice(sourceIndex, 1);
  values.splice(targetIndex, 0, value);
  return true;
}
