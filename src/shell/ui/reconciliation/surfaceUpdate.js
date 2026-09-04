/**
 * @file surfaceUpdate.js
 * @module shell.ui.reconciliation.surfaceUpdate
 *
 * Small value helpers for routing independent popup/top-bar dirty regions.
 */

export function createSurfaceUpdate({ popup = 0, topBar = 0 } = {}) {
  return Object.freeze({ popup, topBar });
}
