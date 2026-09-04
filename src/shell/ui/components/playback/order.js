/**
 * @file order.js
 * @module shell.ui.components.playback.order
 *
 * Defines Shell-only playback-control layout policy.
 *
 * Logical identity and state live in the shared playback contract. This module
 * owns only the ordered placement of those logical controls on Shell surfaces.
 */

import { PlaybackControlIds } from "../../../../shared/playback/controls.js";

/** Popup transport-row order. */
export const POPUP_PRIMARY_PLAYBACK_CONTROL_ORDER = Object.freeze([
  PlaybackControlIds.SEEK_BACKWARD,
  PlaybackControlIds.PREVIOUS,
  PlaybackControlIds.PLAY_PAUSE,
  PlaybackControlIds.NEXT,
  PlaybackControlIds.SEEK_FORWARD,
]);

/** Popup secondary state-control order. */
export const POPUP_SECONDARY_PLAYBACK_CONTROL_ORDER = Object.freeze([
  PlaybackControlIds.SHUFFLE,
  PlaybackControlIds.SPEED,
  PlaybackControlIds.REPEAT,
]);

/** Top bar order before per-control visibility is applied. */
export const TOP_BAR_PLAYBACK_CONTROL_ORDER = Object.freeze([
  PlaybackControlIds.SHUFFLE,
  ...POPUP_PRIMARY_PLAYBACK_CONTROL_ORDER,
  PlaybackControlIds.REPEAT,
]);
