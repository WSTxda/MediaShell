/**
 * @file popupLayout.js
 * @module shared.ui.popupLayout
 *
 * Resolves popup layout constraints without importing Shell or Preferences
 * toolkits. Both processes consume the same width decision without duplicating
 * layout policy.
 */

import { POPUP_WIDTH_CONSTRAINTS } from "../settings/contract.js";

/** Minimum popup width used when the transport row exceeds the compact layout. */
export const POPUP_WIDE_TRANSPORT_MIN_WIDTH = 350;

/**
 * Resolves the popup minimum width required by the visible transport controls.
 *
 * @param {object} controls - Effective transport-control visibility.
 * @param {boolean} controls.showSeekBackward - Whether backward seek is visible.
 * @param {boolean} controls.showPreviousTrack - Whether previous-track is visible.
 * @param {boolean} controls.showPlayPause - Whether play/pause is visible.
 * @param {boolean} controls.showNextTrack - Whether next-track is visible.
 * @param {boolean} controls.showSeekForward - Whether forward seek is visible.
 * @returns {number} Minimum popup width in pixels.
 */
export function resolvePopupMinimumWidth({
  showSeekBackward = false,
  showPreviousTrack = false,
  showPlayPause = false,
  showNextTrack = false,
  showSeekForward = false,
} = {}) {
  const compactWidthUnits =
    Number(showSeekBackward) +
    Number(showPreviousTrack) +
    Number(showNextTrack) +
    Number(showSeekForward) +
    (showPlayPause ? 2 : 0);

  return compactWidthUnits > 4
    ? POPUP_WIDE_TRANSPORT_MIN_WIDTH
    : POPUP_WIDTH_CONSTRAINTS.MIN;
}

/**
 * Resolves the effective popup width without mutating the user's configured width.
 *
 * @param {unknown} configuredWidth - Persisted popup width.
 * @param {object} controls - Effective transport-control visibility.
 * @returns {number} Effective popup width in pixels.
 */
export function resolvePopupWidth(configuredWidth, controls = {}) {
  const numericWidth = Number(configuredWidth);
  const width = Number.isFinite(numericWidth)
    ? Math.min(
        POPUP_WIDTH_CONSTRAINTS.MAX,
        Math.max(POPUP_WIDTH_CONSTRAINTS.MIN, Math.trunc(numericWidth)),
      )
    : POPUP_WIDTH_CONSTRAINTS.DEFAULT;

  return Math.max(width, resolvePopupMinimumWidth(controls));
}
