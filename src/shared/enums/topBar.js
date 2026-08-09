/**
 * @file topBar.js
 * @module shared.enums.topBar
 *
 * Enum values for top bar element identity.
 *
 * Preferences widgets and MediaShellIndicator rely on these stable IDs to
 * preserve
 * the user's chosen element order. Keep this file limited to values that
 * describe top bar elements; panel placement, track-information, and visualizer
 * enums live in their own domain files.
 */

export const TopBarElements = Object.freeze({
  MEDIA_APP_ICON: 0,
  TRACK_INFORMATION: 1,
  PLAYBACK_CONTROLS: 2,
  VISUALIZER: 3,
});

/** Available visual styles for the top-bar media image element. */
export const TopBarImageStyles = Object.freeze({
  APP_ICON: 0,
  ALBUM_ART: 1,
});
