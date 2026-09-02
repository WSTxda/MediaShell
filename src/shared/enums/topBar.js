/**
 * @file topBar.js
 * @module shared.enums.topBar
 *
 * Stable identifiers for top bar elements.
 *
 * Preferences writes and Shell consumes these string IDs through GSettings.
 * Keep this file limited to top bar identity; panel placement,
 * track-information, and visualizer enums live in their own domain files.
 */

export const TopBarElementIds = Object.freeze({
  MEDIA_APP_ICON: "MEDIA_APP_ICON",
  ALBUM_ART: "ALBUM_ART",
  TRACK_INFORMATION: "TRACK_INFORMATION",
  VISUALIZER: "VISUALIZER",
  PLAYBACK_CONTROLS: "PLAYBACK_CONTROLS",
});
