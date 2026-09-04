/**
 * @file popupLayout.js
 * @module shared.ui.popupLayout
 *
 * Resolves popup layout constraints without importing Shell or Preferences
 * toolkits. Both processes consume the same width decision without duplicating
 * layout policy.
 */

import { POPUP_SEEK_CONTROLS_MIN_WIDTH } from "./popup.js";
import { POPUP_WIDTH_CONSTRAINTS } from "../settings/contract.js";

/**
 * Resolves the effective popup width for the configured transport controls.
 *
 * @param {unknown} configuredWidth - Persisted popup width.
 * @param {boolean} showSeekBackward - Whether backward seek is visible.
 * @param {boolean} showSeekForward - Whether forward seek is visible.
 * @param {boolean} showPreviousTrack - Whether previous-track is visible.
 * @param {boolean} showNextTrack - Whether next-track is visible.
 * @returns {number} Effective popup width in pixels.
 */
export function resolvePopupWidth(
  configuredWidth,
  showSeekBackward,
  showSeekForward,
  showPreviousTrack = true,
  showNextTrack = true,
) {
  const numericWidth = Number(configuredWidth);
  const width = Number.isFinite(numericWidth)
    ? Math.min(
        POPUP_WIDTH_CONSTRAINTS.MAX,
        Math.max(POPUP_WIDTH_CONSTRAINTS.MIN, Math.trunc(numericWidth)),
      )
    : POPUP_WIDTH_CONSTRAINTS.DEFAULT;
  const hasSeekControl = showSeekBackward || showSeekForward;
  const hasTrackNavigationControl = showPreviousTrack || showNextTrack;
  return hasSeekControl && hasTrackNavigationControl
    ? Math.max(width, POPUP_SEEK_CONTROLS_MIN_WIDTH)
    : width;
}
