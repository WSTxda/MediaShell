/**
 * @file topBar.js
 * @module shared.ui.topBar
 *
 * Stable identifiers for top bar elements.
 *
 * Preferences writes and Shell consumes these string IDs through GSettings.
 * Keep this file limited to top bar identity; panel placement,
 * track-information, and visualizer enums live in their own domain files.
 */

export const TopBarElementIds = Object.freeze({
  APP_ICON: "app-icon",
  ARTWORK: "artwork",
  TRACK_INFORMATION: "track-information",
  VISUALIZER: "visualizer",
  PLAYBACK_CONTROLS: "playback-controls",
});
