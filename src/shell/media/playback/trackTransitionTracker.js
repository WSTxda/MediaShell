/**
 * @file trackTransitionTracker.js
 * @module shell.media.playback.trackTransitionTracker
 *
 * Classifies canonical track replacements using playback evidence already owned
 * by MprisPlayer. Consumers can distinguish likely natural queue advancement from
 * arbitrary replacement without knowing MPRIS metadata, position math, or UI.
 *
 * MPRIS exposes no transition-cause property, so classification is deliberately
 * bounded and fail-closed. A small end tolerance absorbs ordinary Metadata timing
 * jitter, while a remembered Playing -> Stopped edge survives endpoint signal
 * ordering without depending on player-specific Seeked behavior.
 */

import { createLogger } from "../../../shared/logging/logger.js";
import {
  areMprisTrackIdentitiesEqual,
  createMprisTrackIdentity,
  hasMprisTrackIdentity,
} from "../../mpris/metadata.js";
import {
  MprisPlayerProperties,
  PlaybackStatus,
} from "../../mpris/protocol.js";

const logger = createLogger("TrackTransitionTracker");

/** Small tolerance for Metadata delivered just before the nominal track end. */
const TRACK_COMPLETION_TOLERANCE_MICROSECONDS = 2 * 1000 * 1000;

export const TrackTransitionReasons = Object.freeze({
  COMPLETED: "completed",
  REPLACED: "replaced",
});

function normalizeNonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function resolveCompletionToleranceMicroseconds(
  durationMicroseconds,
  configuredToleranceMicroseconds,
) {
  return Math.min(
    configuredToleranceMicroseconds,
    durationMicroseconds / 2,
  );
}

/** Resolves whether a playback snapshot provides bounded natural-end evidence. */
function resolveTrackTransitionReason(
  previousPlaybackState,
  {
    completionToleranceMicroseconds = TRACK_COMPLETION_TOLERANCE_MICROSECONDS,
  } = {},
) {
  const positionMicroseconds = Number(
    previousPlaybackState?.positionMicroseconds,
  );
  const durationMicroseconds = Number(
    previousPlaybackState?.durationMicroseconds,
  );

  if (
    previousPlaybackState?.playbackStatus !== PlaybackStatus.PLAYING ||
    previousPlaybackState?.clockDiscontinuity === true ||
    !Number.isFinite(positionMicroseconds) ||
    !Number.isFinite(durationMicroseconds) ||
    positionMicroseconds < 0 ||
    durationMicroseconds <= 0
  )
    return TrackTransitionReasons.REPLACED;

  const configuredToleranceMicroseconds = normalizeNonNegativeNumber(
    completionToleranceMicroseconds,
    TRACK_COMPLETION_TOLERANCE_MICROSECONDS,
  );
  const effectiveToleranceMicroseconds = resolveCompletionToleranceMicroseconds(
    durationMicroseconds,
    configuredToleranceMicroseconds,
  );
  const remainingMicroseconds = Math.max(
    0,
    durationMicroseconds - positionMicroseconds,
  );

  return remainingMicroseconds <= effectiveToleranceMicroseconds
    ? TrackTransitionReasons.COMPLETED
    : TrackTransitionReasons.REPLACED;
}

function createPlayingSnapshot(playbackState) {
  if (!playbackState || typeof playbackState !== "object") return null;
  return Object.freeze({
    ...playbackState,
    playbackStatus: PlaybackStatus.PLAYING,
  });
}

/**
 * Tracks one active MprisPlayer and emits semantic track-transition snapshots.
 *
 * The tracker owns only listeners and transition state; it performs no polling,
 * D-Bus calls, or presentation. Switching players re-primes state and emits
 * nothing, so later consumers can reuse the same semantics safely.
 */
export default class TrackTransitionTracker {
  constructor({
    completionToleranceMicroseconds = TRACK_COMPLETION_TOLERANCE_MICROSECONDS,
  } = {}) {
    this.completionToleranceMicroseconds = normalizeNonNegativeNumber(
      completionToleranceMicroseconds,
      TRACK_COMPLETION_TOLERANCE_MICROSECONDS,
    );
    this.player = null;
    this.trackChangeListenerId = 0;
    this.playbackStatusListenerId = 0;
    this.currentTrackIdentity = null;
    this.lastPlaybackStatus = PlaybackStatus.STOPPED;
    this.lastStoppedPlaybackState = null;
    this.pendingTransition = null;
    this.pendingEvaluationGeneration = 0;
    this.listeners = new Map();
    this.nextListenerId = 1;
  }

  setPlayer(player) {
    if (player === this.player) return;
    this.disconnectPlayer();
    this.player = player ?? null;
    if (!this.player) return;

    const observedPlayer = this.player;
    this.currentTrackIdentity = createMprisTrackIdentity(
      observedPlayer.metadata,
    );
    this.lastPlaybackStatus = observedPlayer.playbackStatus;
    this.trackChangeListenerId =
      observedPlayer.onTrackChanged?.((transition) => {
        if (this.player !== observedPlayer) return;
        this.handleTrackChanged(transition);
      }) ?? 0;
    this.playbackStatusListenerId =
      observedPlayer.onPropertyChanged?.(
        MprisPlayerProperties.PLAYBACK_STATUS,
        (playbackStatus) => {
          if (this.player !== observedPlayer) return;
          this.handlePlaybackStatusChanged(playbackStatus);
        },
      ) ?? 0;
  }

  handlePlaybackStatusChanged(playbackStatus) {
    const player = this.player;
    if (!player) return;

    if (
      this.lastPlaybackStatus === PlaybackStatus.PLAYING &&
      playbackStatus === PlaybackStatus.STOPPED &&
      hasMprisTrackIdentity(this.currentTrackIdentity)
    ) {
      const playbackState = createPlayingSnapshot(
        player.snapshotPlaybackState?.(),
      );
      if (playbackState)
        this.lastStoppedPlaybackState = Object.freeze({
          identity: this.currentTrackIdentity,
          playbackState,
        });
    }

    this.lastPlaybackStatus = playbackStatus;
    if (playbackStatus === PlaybackStatus.PLAYING) {
      this.lastStoppedPlaybackState = null;
      this.emitPendingTransitionIfCurrent();
    }
  }

  handleTrackChanged(transition) {
    const player = this.player;
    if (!player) return;

    const previousIdentity = this.currentTrackIdentity;
    const nextIdentity = createMprisTrackIdentity(player.metadata);
    const previousPlaybackState = transition?.previousPlaybackState ?? null;
    const stoppedPlaybackState = this.isStoppedPlaybackStateFor(
      previousIdentity,
    )
      ? this.lastStoppedPlaybackState.playbackState
      : null;
    let reason = resolveTrackTransitionReason(previousPlaybackState, {
      completionToleranceMicroseconds: this.completionToleranceMicroseconds,
    });

    if (
      reason !== TrackTransitionReasons.COMPLETED &&
      player.playbackStatus === PlaybackStatus.STOPPED &&
      stoppedPlaybackState
    )
      reason = resolveTrackTransitionReason(stoppedPlaybackState, {
        completionToleranceMicroseconds: this.completionToleranceMicroseconds,
      });

    const event = Object.freeze({
      player,
      previousTrack: transition?.previousTrack ?? null,
      track: transition?.track ?? null,
      reason,
    });

    this.currentTrackIdentity = nextIdentity;
    this.lastPlaybackStatus = player.playbackStatus;
    this.lastStoppedPlaybackState = null;
    this.pendingTransition = null;
    this.pendingEvaluationGeneration++;

    if (reason !== TrackTransitionReasons.COMPLETED) {
      this.emitTransition(event);
      return;
    }

    this.pendingTransition = Object.freeze({
      event,
      identity: nextIdentity,
    });

    // Metadata and PlaybackStatus can arrive in the same PropertiesChanged
    // batch. Evaluate after the batch has been applied so dictionary order
    // cannot make a paused replacement look like a playing next track.
    const evaluationGeneration = this.pendingEvaluationGeneration;
    Promise.resolve().then(() => {
      try {
        if (
          evaluationGeneration !== this.pendingEvaluationGeneration ||
          this.player !== player
        )
          return;
        this.handlePlaybackStatusChanged(player.playbackStatus);
      } catch (error) {
        logger.errorOnce(
          "pending-transition",
          "Deferred track transition evaluation failed",
          error,
        );
      }
    });
  }

  isStoppedPlaybackStateFor(identity) {
    return Boolean(
      this.lastStoppedPlaybackState &&
        areMprisTrackIdentitiesEqual(
          this.lastStoppedPlaybackState.identity,
          identity,
        ),
    );
  }

  emitPendingTransitionIfCurrent() {
    if (!this.pendingTransition || !this.player) return;

    const currentIdentity = createMprisTrackIdentity(this.player.metadata);
    if (
      !areMprisTrackIdentitiesEqual(
        this.pendingTransition.identity,
        currentIdentity,
      )
    ) {
      this.pendingTransition = null;
      return;
    }

    const { event } = this.pendingTransition;
    this.pendingTransition = null;
    this.emitTransition(event);
  }

  onTransition(callback) {
    if (typeof callback !== "function")
      throw new TypeError("Track transition callback must be a function");
    const listenerId = this.nextListenerId++;
    this.listeners.set(listenerId, callback);
    return () => this.listeners.delete(listenerId);
  }

  emitTransition(transition) {
    for (const callback of [...this.listeners.values()]) {
      try {
        callback(transition);
      } catch (error) {
        logger.errorOnce(
          "transition-listener",
          "Track transition listener failed",
          error,
        );
      }
    }
  }

  disconnectPlayer() {
    const player = this.player;
    if (player) {
      if (this.trackChangeListenerId)
        player.removeTrackChangeListener?.(this.trackChangeListenerId);
      if (this.playbackStatusListenerId)
        player.removePropertyChangeListener?.(
          MprisPlayerProperties.PLAYBACK_STATUS,
          this.playbackStatusListenerId,
        );
    }
    this.player = null;
    this.trackChangeListenerId = 0;
    this.playbackStatusListenerId = 0;
    this.currentTrackIdentity = null;
    this.lastPlaybackStatus = PlaybackStatus.STOPPED;
    this.lastStoppedPlaybackState = null;
    this.pendingTransition = null;
    this.pendingEvaluationGeneration++;
  }

  destroy() {
    this.disconnectPlayer();
    this.listeners.clear();
  }
}
