/**
 * @file playbackController.js
 * @module shell.media.playback.playbackController
 *
 * Owns MediaShell playback command execution above the MPRIS transport layer.
 *
 * MprisPlayer remains responsible for endpoint capability checks and D-Bus
 * calls. This controller resolves MediaShell control IDs, relative seek policy,
 * playback-rate cycling, volume deltas, and active-player targeting so every
 * surface executes the same semantics. A generic command lifecycle lets semantic
 * observers correlate resulting state without adding presentation to this owner.
 */

import {
  PlaybackControlActions,
  RELATIVE_SEEK_SECONDS,
} from "../../../shared/playback/controls.js";
import { createLogger } from "../../../shared/logging/logger.js";
import { LoopStatus } from "../../mpris/protocol.js";
import {
  MprisOperationReasons,
  mprisOperationFailed,
  mprisOperationUnsupported,
  normalizeMprisOperationResult,
} from "../../mpris/operationResult.js";
import { resolveNextPlaybackRate } from "../../mpris/playbackRate.js";

export const PlaybackCommandPhases = Object.freeze({
  STARTED: "started",
  COMPLETED: "completed",
});

const LOOP_STATUS_ORDER = Object.freeze([
  LoopStatus.NONE,
  LoopStatus.PLAYLIST,
  LoopStatus.TRACK,
]);

/** Resolves the next MediaShell repeat mode without touching endpoint state. */
export function resolveNextLoopStatus(loopStatus) {
  const currentIndex = LOOP_STATUS_ORDER.indexOf(loopStatus);
  return LOOP_STATUS_ORDER[
    (currentIndex + 1 + LOOP_STATUS_ORDER.length) % LOOP_STATUS_ORDER.length
  ];
}

/** Resolves the target player volume for one signed MediaShell volume step. */
export function resolveVolumeTarget(currentVolume, delta) {
  const volume = Number(currentVolume);
  const step = Number(delta);
  if (!Number.isFinite(volume) || !Number.isFinite(step)) return null;

  const target = volume + step;
  return step >= 0 ? Math.min(target, 1) : Math.max(target, 0);
}

const PLAYER_OPERATION_BY_ACTION = Object.freeze({
  [PlaybackControlActions.TOGGLE_SHUFFLE]: (player) =>
    player.setShuffle(!player.shuffle),
  [PlaybackControlActions.PREVIOUS]: (player) => player.previous(),
  [PlaybackControlActions.PLAY]: (player) => player.play(),
  [PlaybackControlActions.PAUSE]: (player) => player.pause(),
  [PlaybackControlActions.PLAY_PAUSE]: (player) => player.playPause(),
  [PlaybackControlActions.STOP]: (player) => player.stop(),
  [PlaybackControlActions.NEXT]: (player) => player.next(),
  [PlaybackControlActions.TOGGLE_REPEAT]: (player) =>
    player.setLoopStatus(resolveNextLoopStatus(player.loopStatus)),
});

const SEEK_DIRECTION_BY_ACTION = Object.freeze({
  [PlaybackControlActions.SEEK_BACKWARD]: -1,
  [PlaybackControlActions.SEEK_FORWARD]: 1,
});

const MICROSECONDS_PER_SECOND = 1_000_000;
const logger = createLogger("PlaybackController");

async function executePlayerOperation(player, operationName, operation) {
  if (!player)
    return mprisOperationUnsupported(MprisOperationReasons.MISSING_TARGET);

  try {
    const value = await operation(player);
    return normalizeMprisOperationResult(value);
  } catch (error) {
    logger.errorOnce(
      `${operationName}:${error?.name ?? "Error"}`,
      `Playback operation ${operationName} failed unexpectedly`,
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
  return executePlayerOperation(player, "setPosition", (target) =>
    target.setPosition(expectedTrackId, positionMicroseconds),
  );
}

export async function executePlaybackControlAction(player, action) {
  const seekOffset = resolveSeekOffsetMicroseconds(action);
  if (seekOffset !== null)
    return executePlayerOperation(player, "seek", (target) =>
      target.seek(seekOffset),
    );

  if (action === PlaybackControlActions.CYCLE_SPEED) {
    const nextRate = resolveNextPlaybackRate(
      player?.rate,
      player?.minimumRate,
      player?.maximumRate,
    );
    return nextRate === null
      ? mprisOperationUnsupported(MprisOperationReasons.NO_CHANGE)
      : executePlayerOperation(player, "setPlaybackRate", (target) =>
          target.setPlaybackRate(nextRate),
        );
  }

  if (!Object.hasOwn(PLAYER_OPERATION_BY_ACTION, action))
    return mprisOperationUnsupported(MprisOperationReasons.UNKNOWN_ACTION);

  return executePlayerOperation(
    player,
    action,
    PLAYER_OPERATION_BY_ACTION[action],
  );
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
    this.commandListeners = new Map();
    this.nextCommandListenerId = 1;
    this.nextCommandId = 1;
  }

  get activePlayer() {
    return this.getActivePlayer();
  }

  onCommand(callback) {
    if (typeof callback !== "function")
      throw new TypeError("Playback command callback must be a function");

    const listenerId = this.nextCommandListenerId++;
    this.commandListeners.set(listenerId, callback);
    return () => this.commandListeners.delete(listenerId);
  }

  emitCommand(phase, command, result = null) {
    const event = Object.freeze({ phase, command, result });
    for (const callback of [...this.commandListeners.values()]) {
      try {
        callback(event);
      } catch (error) {
        logger.errorOnce(
          "command-listener",
          "Playback command listener failed",
          error,
        );
      }
    }
  }

  execute(action, player = this.activePlayer, origin = null) {
    const command = Object.freeze({
      id: this.nextCommandId++,
      action,
      player,
      origin,
    });
    this.emitCommand(PlaybackCommandPhases.STARTED, command);

    return executePlaybackControlAction(player, action).then(
      (result) => {
        this.emitCommand(PlaybackCommandPhases.COMPLETED, command, result);
        return result;
      },
      (error) => {
        this.emitCommand(PlaybackCommandPhases.COMPLETED, command);
        throw error;
      },
    );
  }

  setPosition(
    positionMicroseconds,
    player = this.activePlayer,
    expectedTrackId = player?.trackId ?? null,
  ) {
    return executeSetPosition(player, positionMicroseconds, expectedTrackId);
  }

  setVolume(volume, player = this.activePlayer) {
    return executePlayerOperation(player, "setVolume", (target) =>
      target.setVolume(volume),
    );
  }

  increaseVolume(step, player = this.activePlayer) {
    if (!player)
      return mprisOperationUnsupported(MprisOperationReasons.MISSING_TARGET);
    const volume = resolveVolumeTarget(player.volume, step);
    if (volume === null)
      return mprisOperationUnsupported(MprisOperationReasons.INVALID_ARGUMENT);
    return executePlayerOperation(player, "setVolume", (target) =>
      target.setVolume(volume),
    );
  }

  decreaseVolume(step, player = this.activePlayer) {
    if (!player)
      return mprisOperationUnsupported(MprisOperationReasons.MISSING_TARGET);
    const volume = resolveVolumeTarget(player.volume, -step);
    if (volume === null)
      return mprisOperationUnsupported(MprisOperationReasons.INVALID_ARGUMENT);
    return executePlayerOperation(player, "setVolume", (target) =>
      target.setVolume(volume),
    );
  }

  raise(player = this.activePlayer) {
    return executePlayerOperation(player, "raise", (target) => target.raise());
  }

  quit(player = this.activePlayer) {
    return executePlayerOperation(player, "quit", (target) => target.quit());
  }

  destroy() {
    this.commandListeners.clear();
    this.getActivePlayer = null;
  }
}
