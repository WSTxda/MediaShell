/**
 * @file trackTransitionTracker.js
 * @module shell.media.playback.trackTransitionTracker
 *
 * Classifies canonical track replacements using playback evidence already owned
 * by MprisPlayer. Consumers can distinguish likely natural queue advancement from
 * arbitrary replacement without knowing MPRIS metadata, position math, or UI.
 *
 * MPRIS exposes no transition-cause property, so natural completion remains a
 * conservative inference. MediaShell command lifecycle is correlated separately
 * through PlaybackController, allowing consumers to distinguish a replacement
 * caused by MediaShell without coupling command execution to presentation.
 */

import GLib from "gi://GLib";

import { PlaybackControlActions } from "../../../shared/playback/controls.js";
import { createLogger } from "../../../shared/logging/logger.js";
import {
  areMprisTrackIdentitiesEqual,
  createMprisTrackIdentity,
  hasMprisTrackIdentity,
} from "../../mpris/metadata.js";
import { MprisOperationStatuses } from "../../mpris/operationResult.js";
import {
  MprisPlayerProperties,
  PlaybackStatus,
} from "../../mpris/protocol.js";
import {
  PlaybackCommandPhases,
  resolveSeekOffsetMicroseconds,
} from "./playbackController.js";

const logger = createLogger("TrackTransitionTracker");

/** Small tolerance for Metadata delivered just before the nominal track end. */
const TRACK_COMPLETION_TOLERANCE_MICROSECONDS = 2 * 1000 * 1000;
const COMMAND_TRANSITION_TIMEOUT_MS = 2000;

function canCommandReplaceTrack(command) {
  if (!command.player) return false;
  if (
    command.action === PlaybackControlActions.PREVIOUS ||
    command.action === PlaybackControlActions.NEXT
  )
    return true;

  if (command.action === PlaybackControlActions.SEEK_FORWARD) {
    const playbackState = command.player.snapshotPlaybackState();
    const seekOffsetMicroseconds = resolveSeekOffsetMicroseconds(
      command.action,
    );
    const positionMicroseconds = Number(playbackState?.positionMicroseconds);
    const durationMicroseconds = Number(playbackState?.durationMicroseconds);
    return (
      Number.isFinite(positionMicroseconds) &&
      Number.isFinite(durationMicroseconds) &&
      durationMicroseconds > 0 &&
      positionMicroseconds + seekOffsetMicroseconds >= durationMicroseconds
    );
  }

  return (
    (command.action === PlaybackControlActions.PLAY ||
      command.action === PlaybackControlActions.PLAY_PAUSE) &&
    command.player.playbackStatus === PlaybackStatus.STOPPED
  );
}

export const TrackTransitionReasons = Object.freeze({
  COMPLETED: "completed",
  REPLACED: "replaced",
});

function resolveTrackTransitionReason(previousPlaybackState) {
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

  const remainingMicroseconds = Math.max(
    0,
    durationMicroseconds - positionMicroseconds,
  );
  const toleranceMicroseconds = Math.min(
    TRACK_COMPLETION_TOLERANCE_MICROSECONDS,
    durationMicroseconds / 2,
  );

  return remainingMicroseconds <= toleranceMicroseconds
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
 * The tracker owns only listeners, bounded command-correlation sources, and
 * transition state; it performs no polling, D-Bus calls, or presentation.
 * Switching players re-primes state and emits nothing.
 */
export default class TrackTransitionTracker {
  constructor({ playbackCommands = null } = {}) {
    this.player = null;
    this.trackChangeListenerId = 0;
    this.playbackStatusListenerId = 0;
    this.currentTrackIdentity = null;
    this.lastPlaybackStatus = PlaybackStatus.STOPPED;
    this.lastStoppedPlaybackState = null;
    this.pendingTransition = null;
    this.pendingEvaluationGeneration = 0;
    this.pendingCommands = [];
    this.listeners = new Map();
    this.nextListenerId = 1;
    this.unsubscribePlaybackCommands = playbackCommands
      ? playbackCommands.onCommand((event) => this.handlePlaybackCommand(event))
      : null;
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
    this.trackChangeListenerId = observedPlayer.onTrackChanged((transition) => {
      if (this.player !== observedPlayer) return;
      this.handleTrackChanged(transition);
    });
    this.playbackStatusListenerId = observedPlayer.onPropertyChanged(
      MprisPlayerProperties.PLAYBACK_STATUS,
      (playbackStatus) => {
        if (this.player !== observedPlayer) return;
        this.handlePlaybackStatusChanged(playbackStatus);
      },
    );
  }

  handlePlaybackCommand({ phase, command, result }) {
    if (!command) return;
    if (phase === PlaybackCommandPhases.STARTED) {
      if (canCommandReplaceTrack(command)) this.beginPendingCommand(command);
      return;
    }
    if (phase === PlaybackCommandPhases.COMPLETED)
      this.completePendingCommand(command, result);
  }

  beginPendingCommand(command) {
    if (
      command.player !== this.player ||
      !hasMprisTrackIdentity(this.currentTrackIdentity)
    )
      return;

    const context = {
      command,
      sourceIdentity: this.currentTrackIdentity,
      operationSucceeded: false,
      transition: null,
      timeoutId: null,
      active: true,
    };
    context.timeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      COMMAND_TRANSITION_TIMEOUT_MS,
      () => {
        context.timeoutId = null;
        this.removePendingCommand(context);
        return GLib.SOURCE_REMOVE;
      },
    );
    this.pendingCommands.push(context);
  }

  completePendingCommand(command, result) {
    const context = this.pendingCommands.find(
      (candidate) => candidate.active && candidate.command.id === command.id,
    );
    if (!context) return;

    if (result?.status !== MprisOperationStatuses.SUCCESS) {
      const transition = context.transition;
      this.removePendingCommand(context);
      if (transition) this.notifyTransition(transition);
      return;
    }

    context.operationSucceeded = true;
    if (context.transition) this.emitCommandTransition(context);
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
        player.snapshotPlaybackState(),
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
    const stoppedPlaybackState = this.isStoppedPlaybackStateFor(
      previousIdentity,
    )
      ? this.lastStoppedPlaybackState.playbackState
      : null;
    let reason = resolveTrackTransitionReason(transition.previousPlaybackState);

    if (
      reason !== TrackTransitionReasons.COMPLETED &&
      player.playbackStatus === PlaybackStatus.STOPPED &&
      stoppedPlaybackState
    )
      reason = resolveTrackTransitionReason(stoppedPlaybackState);

    const event = Object.freeze({
      player,
      previousTrack: transition.previousTrack,
      track: transition.track,
      reason,
      command: null,
    });

    this.currentTrackIdentity = nextIdentity;
    this.lastPlaybackStatus = player.playbackStatus;
    this.lastStoppedPlaybackState = null;
    this.pendingTransition = null;
    this.pendingEvaluationGeneration++;

    if (reason !== TrackTransitionReasons.COMPLETED) {
      this.emitTransition(event, previousIdentity, nextIdentity);
      return;
    }

    this.pendingTransition = Object.freeze({
      event,
      previousIdentity,
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

    const { event, previousIdentity, identity } = this.pendingTransition;
    this.pendingTransition = null;
    this.emitTransition(event, previousIdentity, identity);
  }

  findPendingCommand(player, previousIdentity) {
    return (
      this.pendingCommands.find(
        (context) =>
          context.active &&
          !context.transition &&
          context.command.player === player &&
          areMprisTrackIdentitiesEqual(
            context.sourceIdentity,
            previousIdentity,
          ),
      ) ?? null
    );
  }

  rebaseFollowingCommands(context, previousIdentity, nextIdentity) {
    const contextIndex = this.pendingCommands.indexOf(context);
    if (contextIndex < 0) return;

    for (
      let index = contextIndex + 1;
      index < this.pendingCommands.length;
      index++
    ) {
      const candidate = this.pendingCommands[index];
      if (
        candidate.active &&
        !candidate.transition &&
        candidate.command.player === context.command.player &&
        areMprisTrackIdentitiesEqual(candidate.sourceIdentity, previousIdentity)
      )
        candidate.sourceIdentity = nextIdentity;
    }
  }

  emitTransition(transition, previousIdentity, nextIdentity) {
    const commandContext = this.findPendingCommand(
      transition.player,
      previousIdentity,
    );
    if (!commandContext) {
      this.notifyTransition(transition);
      return;
    }

    commandContext.transition = transition;
    this.rebaseFollowingCommands(
      commandContext,
      previousIdentity,
      nextIdentity,
    );
    if (commandContext.operationSucceeded)
      this.emitCommandTransition(commandContext);
  }

  emitCommandTransition(context) {
    if (!context.active || !context.transition) return;

    const transition = Object.freeze({
      ...context.transition,
      command: Object.freeze({
        id: context.command.id,
        action: context.command.action,
        origin: context.command.origin,
      }),
    });
    this.removePendingCommand(context);
    this.notifyTransition(transition);
  }

  onTransition(callback) {
    if (typeof callback !== "function")
      throw new TypeError("Track transition callback must be a function");
    const listenerId = this.nextListenerId++;
    this.listeners.set(listenerId, callback);
    return () => this.listeners.delete(listenerId);
  }

  notifyTransition(transition) {
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

  removePendingCommand(context) {
    if (!context || !context.active) return;
    context.active = false;
    if (context.timeoutId !== null) {
      GLib.Source.remove(context.timeoutId);
      context.timeoutId = null;
    }
    const index = this.pendingCommands.indexOf(context);
    if (index >= 0) this.pendingCommands.splice(index, 1);
  }

  clearPendingCommands() {
    for (const context of [...this.pendingCommands])
      this.removePendingCommand(context);
    this.pendingCommands = [];
  }

  disconnectPlayer() {
    const player = this.player;
    if (player) {
      if (this.trackChangeListenerId)
        player.removeTrackChangeListener(this.trackChangeListenerId);
      if (this.playbackStatusListenerId)
        player.removePropertyChangeListener(
          MprisPlayerProperties.PLAYBACK_STATUS,
          this.playbackStatusListenerId,
        );
    }
    this.clearPendingCommands();
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
    if (this.unsubscribePlaybackCommands) this.unsubscribePlaybackCommands();
    this.unsubscribePlaybackCommands = null;
    this.listeners.clear();
  }
}
