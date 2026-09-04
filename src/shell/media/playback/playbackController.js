/**
 * @file playbackController.js
 * @module shell.media.playback.playbackController
 *
 * Owns MediaShell playback command execution above the MPRIS transport layer.
 *
 * MprisPlayer remains responsible for endpoint capability checks and D-Bus
 * calls. This controller resolves MediaShell control IDs, relative seek policy,
 * playback-rate cycling, volume deltas, and active-player targeting so every
 * surface executes the same semantics.
 */

import {
  PlaybackControlActions,
  RELATIVE_SEEK_SECONDS,
} from "../../../shared/playback/controls.js";
import { createLogger } from "../../../shared/logging/logger.js";
import {
  MprisOperationReasons,
  mprisOperationFailed,
  mprisOperationUnsupported,
  normalizeMprisOperationResult,
} from "../../mpris/operationResult.js";
import { resolveNextPlaybackRate } from "../../mpris/playbackRate.js";

const PLAYER_METHOD_BY_ACTION = Object.freeze({
  [PlaybackControlActions.TOGGLE_SHUFFLE]: "toggleShuffle",
  [PlaybackControlActions.PREVIOUS]: "previous",
  [PlaybackControlActions.PLAY]: "play",
  [PlaybackControlActions.PAUSE]: "pause",
  [PlaybackControlActions.PLAY_PAUSE]: "playPause",
  [PlaybackControlActions.STOP]: "stop",
  [PlaybackControlActions.NEXT]: "next",
  [PlaybackControlActions.TOGGLE_REPEAT]: "toggleLoop",
});

const SEEK_DIRECTION_BY_ACTION = Object.freeze({
  [PlaybackControlActions.SEEK_BACKWARD]: -1,
  [PlaybackControlActions.SEEK_FORWARD]: 1,
});

const MICROSECONDS_PER_SECOND = 1_000_000;
const logger = createLogger("PlaybackController");

async function executePlayerMethod(player, methodName, ...arguments_) {
  if (!player)
    return mprisOperationUnsupported(MprisOperationReasons.MISSING_TARGET);

  const method = player[methodName];
  if (typeof method !== "function")
    return mprisOperationUnsupported(MprisOperationReasons.MISSING_METHOD);

  try {
    const value = await method.call(player, ...arguments_);
    return normalizeMprisOperationResult(value);
  } catch (error) {
    logger.errorOnce(
      `${methodName}:${error?.name ?? "Error"}`,
      `Playback delegate ${methodName} failed unexpectedly`,
      error,
    );
    return mprisOperationFailed(
      MprisOperationReasons.DELEGATE_ERROR,
      typeof error?.name === "string" ? error.name : null,
    );
  }
}

/** Converts a directional seek action into its fixed signed microsecond offset. */
export function resolveSeekOffsetMicroseconds(action) {
  const direction = SEEK_DIRECTION_BY_ACTION[action];
  return direction
    ? direction * RELATIVE_SEEK_SECONDS * MICROSECONDS_PER_SECOND
    : null;
}

/**
 * Executes one absolute-position request without reimplementing MPRIS policy.
 *
 * The controller owns MediaShell command routing; MprisPlayer owns capability,
 * TrackId, stale-track, argument, and D-Bus validation. Keeping the raw
 * SetPosition contract at the endpoint boundary preserves one protocol owner.
 */
export async function executeSetPosition(
  player,
  positionMicroseconds,
  expectedTrackId = player?.trackId ?? null,
) {
  return executePlayerMethod(
    player,
    "setPosition",
    expectedTrackId,
    positionMicroseconds,
  );
}

export async function executePlaybackControlAction(player, action) {
  const seekOffset = resolveSeekOffsetMicroseconds(action);
  if (seekOffset !== null)
    return executePlayerMethod(player, "seek", seekOffset);

  if (action === PlaybackControlActions.CYCLE_SPEED) {
    const nextRate = resolveNextPlaybackRate(
      player?.rate,
      player?.minimumRate,
      player?.maximumRate,
    );
    return nextRate === null
      ? mprisOperationUnsupported(MprisOperationReasons.NO_CHANGE)
      : executePlayerMethod(player, "setPlaybackRate", nextRate);
  }

  if (!Object.hasOwn(PLAYER_METHOD_BY_ACTION, action))
    return mprisOperationUnsupported(MprisOperationReasons.UNKNOWN_ACTION);

  return executePlayerMethod(player, PLAYER_METHOD_BY_ACTION[action]);
}

/**
 * Canonical MediaShell playback command boundary.
 *
 * The controller does not own players. MediaRuntime supplies the current active
 * target through a getter so player replacement and owner handoff never leave a
 * stale reference captured by input or UI code.
 */
export default class PlaybackController {
  constructor(getActivePlayer) {
    this.getActivePlayer = getActivePlayer;
  }

  get activePlayer() {
    return this.getActivePlayer?.() ?? null;
  }

  execute(action, player = this.activePlayer) {
    return executePlaybackControlAction(player, action);
  }

  setPosition(
    positionMicroseconds,
    player = this.activePlayer,
    expectedTrackId = player?.trackId ?? null,
  ) {
    return executeSetPosition(player, positionMicroseconds, expectedTrackId);
  }

  setVolume(volume, player = this.activePlayer) {
    return executePlayerMethod(player, "setVolume", volume);
  }

  increaseVolume(step, player = this.activePlayer) {
    if (!player)
      return mprisOperationUnsupported(MprisOperationReasons.MISSING_TARGET);
    return executePlayerMethod(
      player,
      "setVolume",
      Math.min(player.volume + step, 1),
    );
  }

  decreaseVolume(step, player = this.activePlayer) {
    if (!player)
      return mprisOperationUnsupported(MprisOperationReasons.MISSING_TARGET);
    return executePlayerMethod(
      player,
      "setVolume",
      Math.max(player.volume - step, 0),
    );
  }

  raise(player = this.activePlayer) {
    return executePlayerMethod(player, "raise");
  }

  quit(player = this.activePlayer) {
    return executePlayerMethod(player, "quit");
  }

  destroy() {
    this.getActivePlayer = null;
  }
}
