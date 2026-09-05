/**
 * @file selection.js
 * @module shell.mpris.selection
 *
 * Chooses active and next players from registered MPRIS proxies.
 *
 * The pure policy prioritizes pinned, playing, previously active, paused, then
 * stable fallback players. Equal-priority candidates are ordered by their MPRIS
 * bus name while preserving the previous active endpoint inside the same tier.
 */

import { PlaybackStatus } from "./protocol.js";

function resolvePlayerOrderKey(player) {
  return String(player?.busName ?? "");
}

function comparePlayers(firstPlayer, secondPlayer) {
  const firstKey = resolvePlayerOrderKey(firstPlayer);
  const secondKey = resolvePlayerOrderKey(secondPlayer);
  if (firstKey < secondKey) return -1;
  if (firstKey > secondKey) return 1;
  return 0;
}

function choosePreferredTierPlayer(players, previousActiveBusName) {
  return (
    players.find((player) => player.busName === previousActiveBusName) ??
    players[0] ??
    null
  );
}

/**
 * Returns a stable copy of players ordered by their MPRIS endpoint key.
 *
 * Bus names are the registry's lifecycle identity, so ordering does not depend
 * on discovery timing, localized display names, metadata, or Shell app lookup.
 *
 * @param {object[]} players - Player proxies to order.
 * @returns {object[]} New deterministically ordered array.
 */
export function orderPlayersDeterministically(players = []) {
  return [...players].sort(comparePlayers);
}

/**
 * Chooses the active player from registered valid endpoints.
 *
 * Priority order is pinned player, currently playing player, previous
 * active player, paused player, then the first valid player. Within a
 * shared priority tier, the previous active endpoint is preserved; otherwise
 * the stable bus-name order wins.
 *
 * @param {object[]} players - Registered player proxies.
 * @param {string|null} previousActiveBusName - Last active MPRIS bus name.
 * @returns {object|null} Chosen player, or null when none are available.
 */
export function chooseActivePlayer(players = [], previousActiveBusName = null) {
  const validPlayers = orderPlayersDeterministically(
    players.filter((player) => !player.isInvalid),
  );
  if (validPlayers.length === 0) return null;

  const pinnedPlayers = validPlayers.filter((player) => player.isPinned);
  if (pinnedPlayers.length > 0)
    return choosePreferredTierPlayer(pinnedPlayers, previousActiveBusName);

  const playingPlayers = validPlayers.filter(
    (player) => player.playbackStatus === PlaybackStatus.PLAYING,
  );
  if (playingPlayers.length > 0)
    return choosePreferredTierPlayer(playingPlayers, previousActiveBusName);

  const previousActivePlayer = validPlayers.find(
    (player) => player.busName === previousActiveBusName,
  );
  if (previousActivePlayer) return previousActivePlayer;

  const pausedPlayers = validPlayers.filter(
    (player) => player.playbackStatus === PlaybackStatus.PAUSED,
  );
  return pausedPlayers[0] ?? validPlayers[0];
}

/**
 * Chooses the visible active player while an endpoint is awaiting owner recovery.
 *
 * Ownerless endpoints leave the UI immediately. A replacement may take over
 * during the grace period only when it is pinned or playing and the pending
 * endpoint itself is not pinned. Otherwise the UI remains empty until owner
 * recovery or permanent removal resolves the hand-off.
 *
 * @param {object[]} players - Visible registered player proxies.
 * @param {string|null} previousActiveBusName - Last active MPRIS bus name.
 * @param {object|null} pendingActivePlayer - Ownerless active proxy, if any.
 * @returns {object|null} Chosen visible player or null during a protected hand-off.
 */
export function chooseReconciledPlayer(
  players = [],
  previousActiveBusName = null,
  pendingActivePlayer = null,
) {
  const nextActivePlayer = chooseActivePlayer(players, previousActiveBusName);
  if (!pendingActivePlayer) return nextActivePlayer;

  const replacementShouldTakeOver = Boolean(
    nextActivePlayer &&
    !pendingActivePlayer.isPinned &&
    (nextActivePlayer.isPinned ||
      nextActivePlayer.playbackStatus === PlaybackStatus.PLAYING),
  );
  return replacementShouldTakeOver ? nextActivePlayer : null;
}

/**
 * Chooses the next player for player selector and shortcut cycling.
 *
 * @param {object[]} players - Available player proxies.
 * @param {object|null} activePlayer - Active player proxy.
 * @returns {object|null} Next player, or null when cycling is not possible.
 */
export function chooseNextPlayer(players = [], activePlayer = null) {
  const orderedPlayers = orderPlayersDeterministically(
    players.filter((player) => !player.isInvalid),
  );
  if (orderedPlayers.length <= 1) return null;

  const activeIndex = orderedPlayers.findIndex(
    (player) => player.busName === activePlayer?.busName,
  );
  return orderedPlayers[
    activeIndex >= 0 ? (activeIndex + 1) % orderedPlayers.length : 0
  ];
}
