/**
 * @file trackTransitionTracker.js
 * @module shell.media.playback.trackTransitionTracker
 *
 * Classifies canonical track replacements from the MPRIS playback timeline.
 * Natural completion is inferred only from coherent position, duration, rate,
 * playback status, and monotonic time. Command origin is intentionally irrelevant.
 */

import GLib from "gi://GLib";

import { createLogger } from "../../../shared/logging/logger.js";
import {
  areMprisTrackIdentitiesEqual,
  createMprisTrackIdentity,
  hasMprisTrackIdentity,
} from "../../mpris/metadata.js";
import {
  LoopStatus,
  MprisPlayerProperties,
  PlaybackStatus,
} from "../../mpris/protocol.js";

const logger = createLogger("TrackTransitionTracker");

/** Last 10% of a track is eligible, capped so long-form media stays bounded. */
const COMPLETION_WINDOW_RATIO = 0.1;
const MAX_COMPLETION_WINDOW_MICROSECONDS = 60 * 1000 * 1000;

export const TrackTransitionReasons = Object.freeze({
  COMPLETED: "completed",
  REPLACED: "replaced",
});

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

function timelineReachedCompletion(timeline, nowMicroseconds) {
  const now = Number(nowMicroseconds);
  return Boolean(
    timeline &&
    Number.isFinite(now) &&
    now >= timeline.armAtMicroseconds &&
    now >= timeline.endAtMicroseconds,
  );
}

/**
 * Tracks one active MprisPlayer and emits semantic track-transition snapshots.
 *
 * The tracker performs no polling or D-Bus calls. Position changes (including
 * Seeked re-anchors), rate/status changes, and track replacement are consumed as
 * timeline facts. Missing or incoherent timing data fails closed as `replaced`.
 */
export default class TrackTransitionTracker {
  constructor() {
    this.player = null;
    this.trackChangeListenerId = 0;
    this.playbackStatusListenerId = 0;
    this.rateListenerId = 0;
    this.disconnectPositionChange = null;
    this.currentTrackIdentity = null;
    this.timeline = null;
    this.completedIdentity = null;
    this.pendingTransition = null;
    this.pendingEvaluationGeneration = 0;
    this.timelineRefreshGeneration = 0;
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
    this.trackChangeListenerId = observedPlayer.onTrackChanged((transition) => {
      if (this.player !== observedPlayer) return;
      this.handleTrackChanged(transition);
    });
    this.playbackStatusListenerId = observedPlayer.onPropertyChanged(
      MprisPlayerProperties.PLAYBACK_STATUS,
      (playbackStatus) => {
        if (playbackStatus === PlaybackStatus.STOPPED)
          this.rememberCompletionIfReached();
        this.deferTimelineRefresh(observedPlayer);
      },
    );
    this.rateListenerId = observedPlayer.onPropertyChanged(
      MprisPlayerProperties.RATE,
      () => this.deferTimelineRefresh(observedPlayer),
    );
    this.disconnectPositionChange = observedPlayer.onPositionChanged(() => {
      if (this.player !== observedPlayer || !this.isCurrentMetadataTrack())
        return;
      this.refreshTimeline();
    });
    this.refreshTimeline();
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
        if (player.playbackStatus === PlaybackStatus.PLAYING)
          this.emitPendingTransitionIfCurrent();
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

    const playbackState = player.snapshotPlaybackState();
    this.timeline = createCompletionTimeline(
      playbackState,
      GLib.get_monotonic_time(),
    );
  }

  rememberCompletionIfReached() {
    if (
      hasMprisTrackIdentity(this.currentTrackIdentity) &&
      timelineReachedCompletion(this.timeline, GLib.get_monotonic_time())
    )
      this.completedIdentity = this.currentTrackIdentity;
  }

  handleTrackChanged(transition) {
    const player = this.player;
    if (!player) return;

    const previousIdentity = this.currentTrackIdentity;
    const nextIdentity = createMprisTrackIdentity(player.metadata);
    const previousPlaybackState = transition?.previousPlaybackState ?? null;
    const now = GLib.get_monotonic_time();
    const previousTimeline =
      previousPlaybackState?.clockDiscontinuity === true ? null : this.timeline;
    const reachedCompletion =
      this.isCompletedIdentity(previousIdentity) ||
      timelineReachedCompletion(previousTimeline, now);
    const reason =
      reachedCompletion && player.loopStatus !== LoopStatus.TRACK
        ? TrackTransitionReasons.COMPLETED
        : TrackTransitionReasons.REPLACED;
    const event = Object.freeze({
      player,
      previousTrack: transition?.previousTrack ?? null,
      track: transition?.track ?? null,
      reason,
    });

    this.currentTrackIdentity = nextIdentity;
    this.timeline = null;
    this.completedIdentity = null;
    this.pendingTransition = null;
    this.pendingEvaluationGeneration++;
    this.timelineRefreshGeneration++;

    if (reason !== TrackTransitionReasons.COMPLETED) {
      this.notifyTransition(event);
      this.refreshTimeline();
      return;
    }

    this.pendingTransition = Object.freeze({ event, identity: nextIdentity });

    // Metadata and PlaybackStatus may share one PropertiesChanged batch. Wait
    // until the batch is fully applied before requiring the new track to play.
    const evaluationGeneration = this.pendingEvaluationGeneration;
    Promise.resolve().then(() => {
      try {
        if (
          evaluationGeneration !== this.pendingEvaluationGeneration ||
          this.player !== player
        )
          return;
        this.refreshTimeline();
        this.emitPendingTransitionIfCurrent();
      } catch (error) {
        logger.errorOnce(
          "pending-transition",
          "Deferred track transition evaluation failed",
          error,
        );
      }
    });
  }

  isCurrentMetadataTrack() {
    if (!this.player) return false;
    return areMprisTrackIdentitiesEqual(
      this.currentTrackIdentity,
      createMprisTrackIdentity(this.player.metadata),
    );
  }

  isCompletedIdentity(identity) {
    return Boolean(
      this.completedIdentity &&
      areMprisTrackIdentitiesEqual(this.completedIdentity, identity),
    );
  }

  emitPendingTransitionIfCurrent() {
    if (!this.pendingTransition || !this.player) return;
    if (this.player.playbackStatus !== PlaybackStatus.PLAYING) return;

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
    this.notifyTransition(event);
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

    this.player = null;
    this.trackChangeListenerId = 0;
    this.playbackStatusListenerId = 0;
    this.rateListenerId = 0;
    this.disconnectPositionChange = null;
    this.currentTrackIdentity = null;
    this.timeline = null;
    this.completedIdentity = null;
    this.pendingTransition = null;
    this.pendingEvaluationGeneration++;
    this.timelineRefreshGeneration++;
  }

  destroy() {
    this.disconnectPlayer();
    this.listeners.clear();
  }
}
