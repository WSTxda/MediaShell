/**
 * @file topBar.js
 * @module shared.enums.topBar
 *
 * Enum values for top bar element identity.
 *
 * Preferences widgets and TopBarButton rely on these stable IDs to preserve
 * the user's chosen element order. Keep this file limited to values that
 * describe top bar elements; panel placement, track-information, and visualizer
 * enums live in their own domain files.
 */

export const TopBarElements = Object.freeze({
  APP_ICON: 0,
  TRACK_INFORMATION: 1,
  PLAYBACK_CONTROLS: 2,
  VISUALIZER: 3,
});
