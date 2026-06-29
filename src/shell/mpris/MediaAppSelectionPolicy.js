/**
 * @file MediaAppSelectionPolicy.js
 * @module shell.mpris.MediaAppSelectionPolicy
 *
 * Selects active and next media apps from registered MPRIS proxies.
 *
 * The pure policy prioritizes pinned, playing, current, paused, then first valid
 * apps, and exposes deterministic cycling for popup app-selector actions. Keeping
 * this logic pure lets unit tests cover media-app selection without D-Bus or Shell UI.
 */

import { PlaybackStatus } from "../../shared/enums/playback.js";

/**
 * Selects the active media app from registered valid endpoints.
 *
 * Priority order is pinned app, currently playing app, previous active app,
 * paused app, then the first valid app. Pinning survives MPRIS reconnects but
 * not extension reload because pins live only in the runtime registry.
 *
 * @param {object[]} mediaApps - Registered media app proxies.
 * @param {string|null} currentBusName - Bus name that was active before reconciliation.
 * @returns {object|null} Selected media app, or null when none are visible.
 */
export function selectActiveMediaApp(mediaApps, currentBusName = null) {
  const validMediaApps = mediaApps.filter(
    (mediaApp) => !mediaApp.isMediaAppInvalid,
  );
  if (validMediaApps.length === 0) return null;

  const pinned = validMediaApps.find((mediaApp) => mediaApp.isAppPinned());
  if (pinned) return pinned;

  const playing = validMediaApps.find(
    (mediaApp) => mediaApp.playbackStatus === PlaybackStatus.PLAYING,
  );
  if (playing) return playing;

  const current = validMediaApps.find(
    (mediaApp) => mediaApp.busName === currentBusName,
  );
  if (current) return current;

  const paused = validMediaApps.find(
    (mediaApp) => mediaApp.playbackStatus === PlaybackStatus.PAUSED,
  );
  return paused ?? validMediaApps[0];
}

/**
 * Selects the next media app for app-selector and shortcut cycling.
 *
 * @param {object[]} mediaApps - Ordered visible media apps.
 * @param {object|null} currentMediaApp - Current media app proxy.
 * @returns {object|null} Next media app, or null when cycling is not possible.
 */
export function selectNextMediaApp(mediaApps, currentMediaApp = null) {
  if (mediaApps.length <= 1) return null;

  const currentIndex = mediaApps.indexOf(currentMediaApp);
  return (
    mediaApps[currentIndex >= 0 ? (currentIndex + 1) % mediaApps.length : 0] ??
    null
  );
}
