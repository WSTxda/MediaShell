/**
 * @file trackTransitionTracker.js
 * @module shell.media.playback.trackTransitionTracker
 *
 * Classifies canonical track replacements from the MPRIS playback timeline.
 * Natural completion is inferred from bounded near-end evidence, while terminal
 * evidence records the stronger case where the projected end was actually
 * reached. New-track metadata is event-coalesced before consumers are notified
 * so transient endpoint payloads do not escape as presentation state.
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
  LoopStatus,
  MprisPlayerProperties,
  PlaybackStatus,
} from "../../mpris/protocol.js";
import {
  PlaybackCommandPhases,
  resolveSeekOffsetMicroseconds,
} from "./playbackController.js";

const logger = createLogger("TrackTransitionTracker");

/** Last 10% of a track is eligible, capped so long-form media stays bounded. */
const COMPLETION_WINDOW_RATIO = 0.1;
const MAX_COMPLETION_WINDOW_MICROSECONDS = 60 * 1000 * 1000;

/**
 * Metadata often arrives as several PropertiesChanged updates around a track
 * boundary. Coalesce the same identity briefly instead of publishing the first
 * partial snapshot. The hard deadline prevents a noisy endpoint from delaying a
 * semantic transition indefinitely.
 */
const METADATA_SETTLE_TIMEOUT_MS = 600;
const METADATA_SETTLE_DEADLINE_MS = 1800;
const COMMAND_TRANSITION_TIMEOUT_MS = 3000;

/**
 * Near-end evidence is weaker than terminal evidence. Preserve it across short
 * incoherent endpoint gaps, but do not let pause/stop/manual-selection delays
 * turn a stale 90% snapshot into a future natural-completion classification.
 */
const NEAR_END_EVIDENCE_STALE_TIMEOUT_MS = 10000;
const NEAR_END_EVIDENCE_STALE_TIMEOUT_MICROSECONDS =
  NEAR_END_EVIDENCE_STALE_TIMEOUT_MS * 1000;

export const TrackTransitionReasons = Object.freeze({
  COMPLETED: "completed",
  REPLACED: "replaced",
});

export const TrackCompletionEvidence = Object.freeze({
  NONE: "none",
  NEAR_END: "near-end",
  TERMINAL: "terminal",
});

const COMPLETION_EVIDENCE_PRIORITY = Object.freeze({
  [TrackCompletionEvidence.NONE]: 0,
  [TrackCompletionEvidence.NEAR_END]: 1,
  [TrackCompletionEvidence.TERMINAL]: 2,
});

function canCommandReplaceTrack(command) {
  if (!command?.player) return false;
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

function createCompletionTimeline(playbackState, nowMicroseconds) {
  const positionMicroseconds = Number(playbackState?.positionMicroseconds);
  const durationMicroseconds = Number(playbackState?.durationMicroseconds);
  const playbackRate = Number(playbackState?.playbackRate);
  const now = Number(nowMicroseconds);

  if (
    playbackState?.playbackStatus !== PlaybackStatus.PLAYING ||
    playbackState?.clockDiscontinuity === true ||
    !Number.isFinite(positionMicroseconds) ||
    !Number.isFinite(durationMicroseconds) ||
    !Number.isFinite(playbackRate) ||
    !Number.isFinite(now) ||
    positionMicroseconds < 0 ||
    durationMicroseconds <= 0 ||
    playbackRate <= 0
  )
    return null;

  const boundedPositionMicroseconds = Math.min(
    positionMicroseconds,
    durationMicroseconds,
  );
  const completionWindowMicroseconds = Math.min(
    durationMicroseconds * COMPLETION_WINDOW_RATIO,
    MAX_COMPLETION_WINDOW_MICROSECONDS,
  );
  const armPositionMicroseconds =
    durationMicroseconds - completionWindowMicroseconds;

  return Object.freeze({
    armAtMicroseconds:
      now +
      Math.max(0, armPositionMicroseconds - boundedPositionMicroseconds) /
        playbackRate,
    endAtMicroseconds:
      now +
      Math.max(0, durationMicroseconds - boundedPositionMicroseconds) /
        playbackRate,
  });
}

function resolveTimelineCompletionEvidence(timeline, nowMicroseconds) {
  const now = Number(nowMicroseconds);
  if (!timeline || !Number.isFinite(now)) return TrackCompletionEvidence.NONE;
  if (now >= timeline.endAtMicroseconds)
    return TrackCompletionEvidence.TERMINAL;
  if (now >= timeline.armAtMicroseconds)
    return TrackCompletionEvidence.NEAR_END;
  return TrackCompletionEvidence.NONE;
}

function strongestCompletionEvidence(first, second) {
  return COMPLETION_EVIDENCE_PRIORITY[second] >
    COMPLETION_EVIDENCE_PRIORITY[first]
    ? second
    : first;
}

function createCompletionEvidence(
  identity,
  level,
  expiresAtMicroseconds = null,
) {
  return Object.freeze({
    identity,
    level,
    expiresAtMicroseconds,
  });
}

function isNearEndEvidenceExpired(evidence, nowMicroseconds) {
  return Boolean(
    evidence?.level === TrackCompletionEvidence.NEAR_END &&
    Number.isFinite(evidence.expiresAtMicroseconds) &&
    Number(nowMicroseconds) >= evidence.expiresAtMicroseconds,
  );
}

function hasDescriptiveTrackMetadata(track) {
  const title = typeof track?.title === "string" ? track.title.trim() : "";
  if (!title) return false;

  const lengthMicroseconds = Number(track?.lengthMicroseconds);
  return Boolean(
    (Number.isFinite(lengthMicroseconds) && lengthMicroseconds > 0) ||
    track?.artists?.length > 0 ||
    track?.album ||
    track?.albumArtists?.length > 0,
  );
}

/**
 * Tracks one active MprisPlayer and emits semantic track-transition snapshots.
 *
 * The tracker performs no polling or D-Bus calls. Position changes (including
 * Seeked re-anchors), rate/status changes, Metadata revisions, and track
 * replacement are consumed as timeline facts. An optional PlaybackController
 * lifecycle tags MediaShell-driven replacements before presentation. Missing or
 * incoherent timing data fails closed as `replaced`.
 */
export default class TrackTransitionTracker {
  constructor({ playbackCommands = null } = {}) {
    this.player = null;
    this.trackChangeListenerId = 0;
    this.metadataListenerId = 0;
    this.playbackStatusListenerId = 0;
    this.rateListenerId = 0;
    this.disconnectPositionChange = null;
    this.currentTrackIdentity = null;
    this.timeline = null;
    this.completionEvidence = null;
    this.pendingTransition = null;
    this.pendingEvaluationGeneration = 0;
    this.timelineRefreshGeneration = 0;
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
    this.trackChangeListenerId = observedPlayer.onTrackChanged((transition) => {
      if (this.player !== observedPlayer) return;
      this.handleTrackChanged(transition);
    });
    this.metadataListenerId = observedPlayer.onPropertyChanged(
      MprisPlayerProperties.METADATA,
      () => {
        if (this.player !== observedPlayer) return;
        this.handleMetadataChanged();
      },
    );
    this.playbackStatusListenerId = observedPlayer.onPropertyChanged(
      MprisPlayerProperties.PLAYBACK_STATUS,
      () => {
        if (this.player !== observedPlayer) return;
        this.captureCompletionEvidenceIfReached();
        this.deferTimelineRefresh(observedPlayer);
      },
    );
    this.rateListenerId = observedPlayer.onPropertyChanged(
      MprisPlayerProperties.RATE,
      () => {
        if (this.player !== observedPlayer) return;
        this.captureCompletionEvidenceIfReached();
        this.deferTimelineRefresh(observedPlayer);
      },
    );
    this.disconnectPositionChange = observedPlayer.onPositionChanged(() => {
      if (this.player !== observedPlayer || !this.isCurrentMetadataTrack())
        return;
      this.captureCompletionEvidenceIfReached();
      this.refreshTimeline();
    });
    this.refreshTimeline();
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

  deferTimelineRefresh(player) {
    const generation = ++this.timelineRefreshGeneration;
    Promise.resolve().then(() => {
      try {
        if (
          generation !== this.timelineRefreshGeneration ||
          this.player !== player ||
          !this.isCurrentMetadataTrack()
        )
          return;
        this.refreshTimeline();
        this.tryEmitPendingTransition();
      } catch (error) {
        logger.errorOnce(
          "timeline-refresh",
          "Deferred track timeline refresh failed",
          error,
        );
      }
    });
  }

  refreshTimeline() {
    const player = this.player;
    if (!player || !hasMprisTrackIdentity(this.currentTrackIdentity)) {
      this.timeline = null;
      return;
    }

    const now = GLib.get_monotonic_time();
    this.captureCompletionEvidenceIfReached(now);

    const playbackState = player.snapshotPlaybackState();
    const nextTimeline = createCompletionTimeline(playbackState, now);

    // Evidence belongs to one playback session, not forever to the TrackId.
    // Incoherent states may suspend projection; terminal evidence survives,
    // while near-end evidence becomes stale-bounded. A later coherent Playing
    // snapshot is authoritative for the same identity: staying near the end
    // preserves eligibility, while a seek/reload outside the completion window
    // clears it and starts a fresh session.
    if (nextTimeline) {
      const projectedEvidence = resolveTimelineCompletionEvidence(
        nextTimeline,
        now,
      );
      this.completionEvidence =
        projectedEvidence === TrackCompletionEvidence.NONE
          ? null
          : createCompletionEvidence(
              this.currentTrackIdentity,
              projectedEvidence,
            );
    } else {
      this.markNearEndEvidenceStale(now);
    }

    this.timeline = nextTimeline;
  }

  captureCompletionEvidenceIfReached(
    nowMicroseconds = GLib.get_monotonic_time(),
  ) {
    if (!hasMprisTrackIdentity(this.currentTrackIdentity)) return;

    const projectedEvidence = resolveTimelineCompletionEvidence(
      this.timeline,
      nowMicroseconds,
    );
    if (projectedEvidence === TrackCompletionEvidence.NONE) return;

    const currentEvidence = this.getCompletionEvidence(
      this.currentTrackIdentity,
      nowMicroseconds,
    );
    const level = strongestCompletionEvidence(
      currentEvidence,
      projectedEvidence,
    );
    this.completionEvidence = createCompletionEvidence(
      this.currentTrackIdentity,
      level,
    );
  }

  markNearEndEvidenceStale(nowMicroseconds = GLib.get_monotonic_time()) {
    if (
      this.completionEvidence?.level !== TrackCompletionEvidence.NEAR_END ||
      Number.isFinite(this.completionEvidence.expiresAtMicroseconds)
    )
      return;

    this.completionEvidence = createCompletionEvidence(
      this.completionEvidence.identity,
      TrackCompletionEvidence.NEAR_END,
      nowMicroseconds + NEAR_END_EVIDENCE_STALE_TIMEOUT_MICROSECONDS,
    );
  }

  pruneExpiredCompletionEvidence(nowMicroseconds = GLib.get_monotonic_time()) {
    if (!isNearEndEvidenceExpired(this.completionEvidence, nowMicroseconds))
      return;
    this.completionEvidence = null;
  }

  resolvePreviousCompletionEvidence(previousIdentity, previousPlaybackState) {
    const now = GLib.get_monotonic_time();
    const nearEndWasStale = isNearEndEvidenceExpired(
      this.completionEvidence,
      now,
    );
    this.captureCompletionEvidenceIfReached(now);

    let evidence = this.getCompletionEvidence(previousIdentity, now);
    if (previousPlaybackState?.clockDiscontinuity !== true) {
      evidence = strongestCompletionEvidence(
        evidence,
        resolveTimelineCompletionEvidence(this.timeline, now),
      );

      let snapshotEvidence = resolveTimelineCompletionEvidence(
        createCompletionTimeline(previousPlaybackState, now),
        now,
      );
      if (
        nearEndWasStale &&
        snapshotEvidence === TrackCompletionEvidence.NEAR_END
      )
        snapshotEvidence = TrackCompletionEvidence.NONE;

      evidence = strongestCompletionEvidence(evidence, snapshotEvidence);
    }
    return evidence;
  }

  handleTrackChanged(transition) {
    const player = this.player;
    if (!player) return;

    const previousIdentity = this.currentTrackIdentity;
    const nextIdentity = createMprisTrackIdentity(player.metadata);
    const completionEvidence = this.resolvePreviousCompletionEvidence(
      previousIdentity,
      transition?.previousPlaybackState ?? null,
    );
    const hasMediaShellCommand = Boolean(
      this.findPendingCommand(player, previousIdentity),
    );
    const reason =
      !hasMediaShellCommand &&
      completionEvidence !== TrackCompletionEvidence.NONE &&
      player.loopStatus !== LoopStatus.TRACK
        ? TrackTransitionReasons.COMPLETED
        : TrackTransitionReasons.REPLACED;

    const previousTrack = transition?.previousTrack ?? null;
    const track = transition?.track ?? player.track ?? null;

    this.cancelPendingTransition();
    this.currentTrackIdentity = nextIdentity;
    this.timeline = null;
    this.completionEvidence = null;
    this.pendingEvaluationGeneration++;
    this.timelineRefreshGeneration++;

    if (reason !== TrackTransitionReasons.COMPLETED) {
      this.emitTransition(
        Object.freeze({
          player,
          previousTrack,
          track,
          reason,
          completionEvidence,
          command: null,
        }),
        previousIdentity,
        nextIdentity,
      );
      this.refreshTimeline();
      return;
    }

    this.beginPendingTransition({
      player,
      previousTrack,
      track,
      reason,
      completionEvidence,
      previousIdentity,
      identity: nextIdentity,
    });

    // Metadata and PlaybackStatus may share one PropertiesChanged batch. Wait
    // until the batch is fully applied before rebuilding the new timeline or
    // deciding that the new track has actually started.
    const evaluationGeneration = this.pendingEvaluationGeneration;
    Promise.resolve().then(() => {
      try {
        if (
          evaluationGeneration !== this.pendingEvaluationGeneration ||
          this.player !== player
        )
          return;
        this.refreshTimeline();
        this.tryEmitPendingTransition();
      } catch (error) {
        logger.errorOnce(
          "pending-transition",
          "Deferred track transition evaluation failed",
          error,
        );
      }
    });
  }

  beginPendingTransition({
    player,
    previousTrack,
    track,
    reason,
    completionEvidence,
    previousIdentity,
    identity,
  }) {
    const context = {
      player,
      previousTrack,
      latestTrack: track,
      reason,
      completionEvidence,
      previousIdentity,
      identity,
      metadataSettled: false,
      settleTimeoutId: null,
      deadlineTimeoutId: null,
      active: true,
    };
    this.pendingTransition = context;
    context.deadlineTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      METADATA_SETTLE_DEADLINE_MS,
      () => {
        context.deadlineTimeoutId = null;
        if (!context.active) return GLib.SOURCE_REMOVE;
        context.metadataSettled = true;
        if (context.settleTimeoutId !== null) {
          GLib.Source.remove(context.settleTimeoutId);
          context.settleTimeoutId = null;
        }
        this.tryEmitPendingTransition(context);
        return GLib.SOURCE_REMOVE;
      },
    );
    this.scheduleMetadataSettle(context);
  }

  scheduleMetadataSettle(context) {
    if (!context?.active || context.deadlineTimeoutId === null) return;
    if (context.settleTimeoutId !== null) {
      GLib.Source.remove(context.settleTimeoutId);
      context.settleTimeoutId = null;
    }

    context.metadataSettled = false;
    context.settleTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      METADATA_SETTLE_TIMEOUT_MS,
      () => {
        context.settleTimeoutId = null;
        if (!context.active) return GLib.SOURCE_REMOVE;
        if (!hasDescriptiveTrackMetadata(context.latestTrack))
          return GLib.SOURCE_REMOVE;
        context.metadataSettled = true;
        this.tryEmitPendingTransition(context);
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  handleMetadataChanged() {
    const context = this.pendingTransition;
    const player = this.player;
    if (!context || !context.active || !player) return;

    const currentIdentity = createMprisTrackIdentity(player.metadata);
    if (!areMprisTrackIdentitiesEqual(context.identity, currentIdentity)) {
      this.cancelPendingTransition(context);
      return;
    }

    context.latestTrack = player.track ?? context.latestTrack;
    if (context.deadlineTimeoutId !== null)
      this.scheduleMetadataSettle(context);
  }

  isCurrentMetadataTrack() {
    if (!this.player) return false;
    return areMprisTrackIdentitiesEqual(
      this.currentTrackIdentity,
      createMprisTrackIdentity(this.player.metadata),
    );
  }

  getCompletionEvidence(identity, nowMicroseconds = GLib.get_monotonic_time()) {
    this.pruneExpiredCompletionEvidence(nowMicroseconds);
    return this.completionEvidence &&
      areMprisTrackIdentitiesEqual(this.completionEvidence.identity, identity)
      ? this.completionEvidence.level
      : TrackCompletionEvidence.NONE;
  }

  tryEmitPendingTransition(context = this.pendingTransition) {
    const player = this.player;
    if (!context || !context.active || context !== this.pendingTransition)
      return;
    if (!player || player !== context.player || !context.metadataSettled)
      return;

    const currentIdentity = createMprisTrackIdentity(player.metadata);
    if (!areMprisTrackIdentitiesEqual(context.identity, currentIdentity)) {
      this.cancelPendingTransition(context);
      return;
    }

    if (
      context.reason === TrackTransitionReasons.COMPLETED &&
      player.playbackStatus !== PlaybackStatus.PLAYING
    )
      return;

    context.latestTrack = player.track ?? context.latestTrack;
    const event = Object.freeze({
      player,
      previousTrack: context.previousTrack,
      track: context.latestTrack,
      reason: context.reason,
      completionEvidence: context.completionEvidence,
      command: null,
    });
    const previousIdentity = context.previousIdentity;
    const nextIdentity = context.identity;
    this.cancelPendingTransition(context);
    this.emitTransition(event, previousIdentity, nextIdentity);
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

  cancelPendingTransition(context = this.pendingTransition) {
    if (!context || !context.active) return;
    context.active = false;
    if (context.settleTimeoutId !== null) {
      GLib.Source.remove(context.settleTimeoutId);
      context.settleTimeoutId = null;
    }
    if (context.deadlineTimeoutId !== null) {
      GLib.Source.remove(context.deadlineTimeoutId);
      context.deadlineTimeoutId = null;
    }
    if (this.pendingTransition === context) this.pendingTransition = null;
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

  disconnectPlayer() {
    const player = this.player;
    if (player) {
      if (this.trackChangeListenerId)
        player.removeTrackChangeListener(this.trackChangeListenerId);
      if (this.metadataListenerId)
        player.removePropertyChangeListener(
          MprisPlayerProperties.METADATA,
          this.metadataListenerId,
        );
      if (this.playbackStatusListenerId)
        player.removePropertyChangeListener(
          MprisPlayerProperties.PLAYBACK_STATUS,
          this.playbackStatusListenerId,
        );
      if (this.rateListenerId)
        player.removePropertyChangeListener(
          MprisPlayerProperties.RATE,
          this.rateListenerId,
        );
    }
    if (this.disconnectPositionChange) this.disconnectPositionChange();

    this.cancelPendingTransition();
    this.clearPendingCommands();
    this.player = null;
    this.trackChangeListenerId = 0;
    this.metadataListenerId = 0;
    this.playbackStatusListenerId = 0;
    this.rateListenerId = 0;
    this.disconnectPositionChange = null;
    this.currentTrackIdentity = null;
    this.timeline = null;
    this.completionEvidence = null;
    this.pendingEvaluationGeneration++;
    this.timelineRefreshGeneration++;
  }

  destroy() {
    this.disconnectPlayer();
    if (this.unsubscribePlaybackCommands) this.unsubscribePlaybackCommands();
    this.unsubscribePlaybackCommands = null;
    this.listeners.clear();
  }
}
