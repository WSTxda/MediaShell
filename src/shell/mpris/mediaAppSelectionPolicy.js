/**
 * @file mediaAppSelectionPolicy.js
 * @module shell.mpris.mediaAppSelectionPolicy
 *
 * Chooses active and next media apps from registered MPRIS proxies.
 *
 * The pure policy prioritizes pinned, playing, previously active, paused, then
 * stable fallback apps. Equal-priority candidates are ordered by their MPRIS
 * bus name while preserving the previous active endpoint inside the same tier.
 */

import { PlaybackStatus } from "../../shared/enums/playback.js";

function getMediaAppOrderKey(mediaApp) {
  return String(mediaApp?.busName ?? "");
}

function compareMediaApps(firstMediaApp, secondMediaApp) {
  const firstKey = getMediaAppOrderKey(firstMediaApp);
  const secondKey = getMediaAppOrderKey(secondMediaApp);
  if (firstKey < secondKey) return -1;
  if (firstKey > secondKey) return 1;
  return 0;
}

function choosePreferredTierMediaApp(mediaApps, previousActiveBusName) {
  return (
    mediaApps.find((mediaApp) => mediaApp.busName === previousActiveBusName) ??
    mediaApps[0] ??
    null
  );
}

/**
 * Returns a stable copy of media apps ordered by their MPRIS endpoint key.
 *
 * Bus names are the registry's lifecycle identity, so ordering does not depend
 * on discovery timing, localized display names, metadata, or Shell app lookup.
 *
 * @param {object[]} mediaApps - Media app proxies to order.
 * @returns {object[]} New deterministically ordered array.
 */
export function orderMediaAppsDeterministically(mediaApps = []) {
  return [...mediaApps].sort(compareMediaApps);
}

/**
 * Chooses the active media app from registered valid endpoints.
 *
 * Priority order is pinned media app, currently playing media app, previous
 * active media app, paused media app, then the first valid media app. Within a
 * shared priority tier, the previous active endpoint is preserved; otherwise
 * the stable bus-name order wins.
 *
 * @param {object[]} mediaApps - Registered media app proxies.
 * @param {string|null} previousActiveBusName - Last active MPRIS bus name.
 * @returns {object|null} Chosen media app, or null when none are available.
 */
export function chooseActiveMediaApp(
  mediaApps = [],
  previousActiveBusName = null,
) {
  const validMediaApps = orderMediaAppsDeterministically(
    mediaApps.filter((mediaApp) => !mediaApp.isMediaAppInvalid),
  );
  if (validMediaApps.length === 0) return null;

  const pinnedMediaApps = validMediaApps.filter(
    (mediaApp) => mediaApp.isPinned,
  );
  if (pinnedMediaApps.length > 0)
    return choosePreferredTierMediaApp(pinnedMediaApps, previousActiveBusName);

  const playingMediaApps = validMediaApps.filter(
    (mediaApp) => mediaApp.playbackStatus === PlaybackStatus.PLAYING,
  );
  if (playingMediaApps.length > 0)
    return choosePreferredTierMediaApp(playingMediaApps, previousActiveBusName);

  const previousActiveMediaApp = validMediaApps.find(
    (mediaApp) => mediaApp.busName === previousActiveBusName,
  );
  if (previousActiveMediaApp) return previousActiveMediaApp;

  const pausedMediaApps = validMediaApps.filter(
    (mediaApp) => mediaApp.playbackStatus === PlaybackStatus.PAUSED,
  );
  return pausedMediaApps[0] ?? validMediaApps[0];
}

/**
 * Chooses the visible active app while an endpoint is awaiting owner recovery.
 *
 * Ownerless endpoints leave the UI immediately. A replacement may take over
 * during the grace period only when it is pinned or playing and the pending
 * endpoint itself is not pinned. Otherwise the UI remains empty until owner
 * recovery or permanent removal resolves the hand-off.
 *
 * @param {object[]} mediaApps - Visible registered media app proxies.
 * @param {string|null} previousActiveBusName - Last active MPRIS bus name.
 * @param {object|null} pendingActiveMediaApp - Ownerless active proxy, if any.
 * @returns {object|null} Chosen visible app or null during a protected hand-off.
 */
export function chooseReconciledMediaApp(
  mediaApps = [],
  previousActiveBusName = null,
  pendingActiveMediaApp = null,
) {
  const nextActiveMediaApp = chooseActiveMediaApp(
    mediaApps,
    previousActiveBusName,
  );
  if (!pendingActiveMediaApp) return nextActiveMediaApp;

  const replacementShouldTakeOver = Boolean(
    nextActiveMediaApp &&
    !pendingActiveMediaApp.isPinned &&
    (nextActiveMediaApp.isPinned ||
      nextActiveMediaApp.playbackStatus === PlaybackStatus.PLAYING),
  );
  return replacementShouldTakeOver ? nextActiveMediaApp : null;
}

/**
 * Chooses the next media app for media app selector and shortcut cycling.
 *
 * @param {object[]} mediaApps - Available media app proxies.
 * @param {object|null} activeMediaApp - Active media app proxy.
 * @returns {object|null} Next media app, or null when cycling is not possible.
 */
export function chooseNextMediaApp(mediaApps = [], activeMediaApp = null) {
  const orderedMediaApps = orderMediaAppsDeterministically(
    mediaApps.filter((mediaApp) => !mediaApp.isMediaAppInvalid),
  );
  if (orderedMediaApps.length <= 1) return null;

  const activeIndex = orderedMediaApps.findIndex(
    (mediaApp) => mediaApp.busName === activeMediaApp?.busName,
  );
  return orderedMediaApps[
    activeIndex >= 0 ? (activeIndex + 1) % orderedMediaApps.length : 0
  ];
}
