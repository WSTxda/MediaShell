/**
 * @file collections.js
 * @module shared.utils.collections
 *
 * Provides small, toolkit-independent collection mutations with explicit validation.
 *
 * Preferences reorderable widgets use the same index rules so drag-and-drop
 * behavior cannot drift between top bar elements and track-information content.
 */

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
