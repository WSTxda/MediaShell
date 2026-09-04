/**
 * @file playbackControlExecutor.js
 * @module shell.mpris.playbackControlExecutor
 *
 * Executes resolved playback action IDs against the active MprisMediaApp.
 *
 * This is the single Shell boundary used by popup, top bar, and input dispatch.
 * MprisMediaApp remains responsible for capability checks and all D-Bus calls.
 */

import {
  PlaybackControlActions,
  RELATIVE_SEEK_SECONDS,
} from "../../shared/playback/controls.js";
import { createLogger } from "../../shared/logging/logger.js";
import {
  MprisOperationReasons,
  mprisOperationFailed,
  mprisOperationUnsupported,
  normalizeMprisOperationResult,
} from "./operationResult.js";
import { resolveNextPlaybackRate } from "./playbackRate.js";

const MEDIA_APP_METHOD_BY_ACTION = Object.freeze({
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
const logger = createLogger("playbackControlExecutor");

async function executeDelegate(mediaApp, methodName, argument = undefined) {
  if (!mediaApp)
    return mprisOperationUnsupported(MprisOperationReasons.MISSING_TARGET);
  const method = mediaApp[methodName];
  if (typeof method !== "function")
    return mprisOperationUnsupported(MprisOperationReasons.MISSING_METHOD);

  try {
    const value =
      argument === undefined
        ? await method.call(mediaApp)
        : await method.call(mediaApp, argument);
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

/** Executes one canonical playback action against a MprisMediaApp-like object. */
export async function executePlaybackControlAction(mediaApp, action) {
  const seekOffset = resolveSeekOffsetMicroseconds(action);
  if (seekOffset !== null) return executeDelegate(mediaApp, "seek", seekOffset);

  if (action === PlaybackControlActions.CYCLE_SPEED) {
    const nextRate = resolveNextPlaybackRate(
      mediaApp?.rate,
      mediaApp?.minimumRate,
      mediaApp?.maximumRate,
    );
    return nextRate === null
      ? mprisOperationUnsupported(MprisOperationReasons.NO_CHANGE)
      : executeDelegate(mediaApp, "setPlaybackRate", nextRate);
  }

  if (!Object.hasOwn(MEDIA_APP_METHOD_BY_ACTION, action))
    return mprisOperationUnsupported(MprisOperationReasons.UNKNOWN_ACTION);
  return executeDelegate(mediaApp, MEDIA_APP_METHOD_BY_ACTION[action]);
}
