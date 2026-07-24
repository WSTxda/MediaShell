/**
 * @file mediaAppSelectionPolicy.js
 * @module shell.mpris.mediaAppSelectionPolicy
 *
 * Chooses active and next media apps from registered MPRIS proxies.
 *
 * The pure policy prioritizes pinned, playing, previously active, paused, then
 * first valid apps, and exposes deterministic cycling for popup app selector
 * actions. Keeping this logic pure lets unit tests cover media-app selection
 * without D-Bus or Shell UI.
 */

import { PlaybackStatus } from "../../shared/enums/playback.js";

/**
 * Chooses the active media app from registered valid endpoints.
 *
 * Priority order is pinned media app, currently playing media app, previous
 * active media app, paused media app, then the first valid media app. Pinning
 * survives MPRIS reconnects but not extension reload because pins live only in
 * the runtime registry.
 *
 * @param {object[]} mediaApps - Registered media app proxies.
 * @param {string|null} previousActiveBusName - Bus name active before reconciliation.
 * @returns {object|null} Chosen media app, or null when none are available.
 */
export function chooseActiveMediaApp(mediaApps, previousActiveBusName = null) {
  const validMediaApps = mediaApps.filter(
    (mediaApp) => !mediaApp.isMediaAppInvalid,
  );
  if (validMediaApps.length === 0) return null;

  const pinnedMediaApp = validMediaApps.find((mediaApp) => mediaApp.isPinned);
  if (pinnedMediaApp) return pinnedMediaApp;

  const playingMediaApp = validMediaApps.find(
    (mediaApp) => mediaApp.playbackStatus === PlaybackStatus.PLAYING,
  );
  if (playingMediaApp) return playingMediaApp;

  const previousActiveMediaApp = validMediaApps.find(
    (mediaApp) => mediaApp.busName === previousActiveBusName,
  );
  if (previousActiveMediaApp) return previousActiveMediaApp;

  const pausedMediaApp = validMediaApps.find(
    (mediaApp) => mediaApp.playbackStatus === PlaybackStatus.PAUSED,
  );
  return pausedMediaApp ?? validMediaApps[0];
}

/**
 * Chooses the next media app for app selector and shortcut cycling.
 *
 * @param {object[]} mediaApps - Ordered available media apps.
 * @param {object|null} activeMediaApp - Active media app proxy.
 * @returns {object|null} Next media app, or null when cycling is not possible.
 */
export function chooseNextMediaApp(mediaApps, activeMediaApp = null) {
  if (mediaApps.length <= 1) return null;

  const activeIndex = mediaApps.indexOf(activeMediaApp);
  return (
    mediaApps[activeIndex >= 0 ? (activeIndex + 1) % mediaApps.length : 0] ??
    null
  );
}
