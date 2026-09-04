/**
 * @file positionTracker.js
 * @module shell.mpris.positionTracker
 *
 * Tracks MPRIS position using exact reads, Seeked signals, and bounded projection.
 *
 * MprisPlayer delegates position state here so UI components can render a live
 * estimate without polling D-Bus. Pure calculation stays in position.js;
 * this class owns Gio calls, clock snapshots, listener delivery, and lifecycle.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { DbusPropertiesMethods } from "./dbus.js";
import { MPRIS_PLAYER_IFACE_NAME, MprisPlayerProperties } from "./protocol.js";
import { DBUS_CALL_TIMEOUT_MS } from "./clientPolicy.js";
import { PlaybackStatus } from "./protocol.js";
import { createLogger } from "../../shared/logging/logger.js";
import {
  normalizePlaybackPositionMicroseconds,
  normalizePositionPlaybackRate,
  normalizeTrackDurationMicroseconds,
  resolvePlaybackPositionEstimate,
} from "./position.js";
import { isCancellationError } from "../platform/gioErrors.js";

Gio._promisify(Gio.DBusProxy.prototype, "call", "call_finish");

const logger = createLogger("MprisPositionTracker");

const DEFAULT_CLOCK = Object.freeze({
  getMonotonicTime: () => GLib.get_monotonic_time(),
  getRealTime: () => GLib.get_real_time(),
});

/**
 * Tracks MPRIS position using explicit reads, Seeked signals, and clock projection.
 */
export default class MprisPositionTracker {
  constructor(propertiesProxy, operationCancellable = null, clock = {}) {
    this.propertiesProxy = propertiesProxy;
    this.operationCancellable = operationCancellable;
    this.getMonotonicTime =
      typeof clock.getMonotonicTime === "function"
        ? clock.getMonotonicTime
        : DEFAULT_CLOCK.getMonotonicTime;
    this.getRealTime =
      typeof clock.getRealTime === "function"
        ? clock.getRealTime
        : DEFAULT_CLOCK.getRealTime;
    this.positionMicroseconds = 0;
    this.durationMicroseconds = null;
    this.trackIdentity = null;
    this.playbackRate = 1;
    this.playbackStatus = PlaybackStatus.STOPPED;
    const clockSnapshot = this.readClockSnapshot();
    this.anchorMonotonicMicroseconds = clockSnapshot.monotonicMicroseconds;
    this.anchorRealMicroseconds = clockSnapshot.realMicroseconds;
    this.positionChangeListeners = new Map();
    this.nextPositionChangeListenerId = 1;
    this.positionRefreshGeneration = 0;
    this.positionRefreshPromise = null;
  }

  readClockSnapshot() {
    return {
      monotonicMicroseconds: Number(this.getMonotonicTime()),
      realMicroseconds: Number(this.getRealTime()),
    };
  }

  resolveCurrentEstimate() {
    const clockSnapshot = this.readClockSnapshot();
    return resolvePlaybackPositionEstimate({
      positionMicroseconds: this.positionMicroseconds,
      durationMicroseconds: this.durationMicroseconds,
      playbackStatus: this.playbackStatus,
      playbackRate: this.playbackRate,
      anchorMonotonicMicroseconds: this.anchorMonotonicMicroseconds,
      currentMonotonicMicroseconds: clockSnapshot.monotonicMicroseconds,
      anchorRealMicroseconds: this.anchorRealMicroseconds,
      currentRealMicroseconds: clockSnapshot.realMicroseconds,
    });
  }

  setPositionAnchor(
    positionMicroseconds,
    { emit = false, invalidatePendingRefresh = true } = {},
  ) {
    if (invalidatePendingRefresh) {
      this.positionRefreshGeneration++;
      this.positionRefreshPromise = null;
    }

    this.positionMicroseconds = normalizePlaybackPositionMicroseconds(
      positionMicroseconds,
      this.durationMicroseconds,
    );
    const clockSnapshot = this.readClockSnapshot();
    this.anchorMonotonicMicroseconds = clockSnapshot.monotonicMicroseconds;
    this.anchorRealMicroseconds = clockSnapshot.realMicroseconds;
    if (emit) this.emitPositionChanged(this.positionMicroseconds);
    return this.positionMicroseconds;
  }

  updatePlaybackState(playbackStatus, playbackRate) {
    if (!this.propertiesProxy) return;

    const nextPlaybackStatus = playbackStatus ?? PlaybackStatus.STOPPED;
    const nextPlaybackRate = normalizePositionPlaybackRate(playbackRate);
    if (
      nextPlaybackStatus === this.playbackStatus &&
      nextPlaybackRate === this.playbackRate
    ) {
      if (
        this.playbackStatus !== PlaybackStatus.PLAYING &&
        !this.positionRefreshPromise
      )
        this.requestPositionRefresh("idle-playback-state");
      return;
    }

    const estimate = this.resolveCurrentEstimate();
    this.setPositionAnchor(estimate.positionMicroseconds);
    this.playbackStatus = nextPlaybackStatus;
    this.playbackRate = nextPlaybackRate;

    if (
      estimate.shouldRefresh ||
      this.playbackStatus !== PlaybackStatus.PLAYING
    )
      this.requestPositionRefresh("playback-state");
  }

  updateTrackContext(
    { identity = null, durationMicroseconds = null } = {},
    { refresh = true } = {},
  ) {
    if (!this.propertiesProxy) return false;

    const nextIdentity = identity == null ? null : String(identity);
    const nextDurationMicroseconds =
      normalizeTrackDurationMicroseconds(durationMicroseconds);
    const trackChanged = nextIdentity !== this.trackIdentity;
    this.trackIdentity = nextIdentity;
    this.durationMicroseconds = nextDurationMicroseconds;

    if (!trackChanged) {
      const boundedPositionMicroseconds = normalizePlaybackPositionMicroseconds(
        this.positionMicroseconds,
        this.durationMicroseconds,
      );
      if (boundedPositionMicroseconds !== this.positionMicroseconds)
        this.setPositionAnchor(boundedPositionMicroseconds, { emit: true });
      return false;
    }

    this.setPositionAnchor(0, { emit: true });
    if (refresh) this.requestPositionRefresh("track-change", true);
    return true;
  }

  resetForOwnerChange() {
    if (!this.propertiesProxy) return;

    this.positionRefreshGeneration++;
    this.positionRefreshPromise = null;
    this.trackIdentity = null;
    this.durationMicroseconds = null;
    this.playbackRate = 1;
    this.playbackStatus = PlaybackStatus.STOPPED;
    this.setPositionAnchor(0, {
      emit: true,
      invalidatePendingRefresh: false,
    });
  }

  handleSeeked(positionMicroseconds) {
    if (!this.propertiesProxy) return;
    this.setPositionAnchor(positionMicroseconds, { emit: true });
  }

  getEstimatedPositionMicroseconds() {
    if (!this.propertiesProxy) return this.positionMicroseconds;

    const estimate = this.resolveCurrentEstimate();
    if (estimate.shouldRefresh)
      this.requestPositionRefresh(
        estimate.clockDiscontinuity ? "clock-discontinuity" : "stale-estimate",
      );
    return estimate.positionMicroseconds;
  }

  async getPositionMicroseconds() {
    try {
      await this.refreshPosition();
    } catch (error) {
      if (isCancellationError(error))
        return this.getEstimatedPositionMicroseconds();
      // A transient read failure must not blank a still-useful local estimate.
      logger.debugOnce(
        "estimated-position",
        "Using estimated position after a D-Bus read failed",
        error,
      );
    }
    return this.getEstimatedPositionMicroseconds();
  }

  requestPositionRefresh(reason, force = false) {
    void this.refreshPosition(force).catch((error) => {
      if (!isCancellationError(error))
        logger.debugOnce(
          `position-refresh:${reason}`,
          "Exact MPRIS position refresh failed",
          reason,
          error,
        );
    });
  }

  refreshPosition(force = false) {
    if (!this.propertiesProxy)
      return Promise.resolve(this.positionMicroseconds);
    if (this.positionRefreshPromise && !force)
      return this.positionRefreshPromise;

    const refreshGeneration = ++this.positionRefreshGeneration;
    const promise = this.readPositionMicroseconds(refreshGeneration).finally(
      () => {
        if (this.positionRefreshPromise === promise)
          this.positionRefreshPromise = null;
      },
    );
    this.positionRefreshPromise = promise;
    return promise;
  }

  async readPositionMicroseconds(refreshGeneration) {
    const propertiesProxy = this.propertiesProxy;
    const operationCancellable = this.operationCancellable;
    if (!propertiesProxy) return this.positionMicroseconds;

    const result = await propertiesProxy.call(
      DbusPropertiesMethods.GET,
      new GLib.Variant("(ss)", [
        MPRIS_PLAYER_IFACE_NAME,
        MprisPlayerProperties.POSITION,
      ]),
      Gio.DBusCallFlags.NONE,
      DBUS_CALL_TIMEOUT_MS,
      operationCancellable,
    );

    if (
      propertiesProxy !== this.propertiesProxy ||
      refreshGeneration !== this.positionRefreshGeneration
    )
      return this.positionMicroseconds;

    const value = result.get_child_value(0).get_variant();
    return this.setPositionAnchor(value.recursiveUnpack(), {
      emit: true,
      invalidatePendingRefresh: false,
    });
  }

  onPositionChanged(callback) {
    if (!this.propertiesProxy || typeof callback !== "function")
      return () => {};
    const listenerId = this.nextPositionChangeListenerId++;
    this.positionChangeListeners.set(listenerId, callback);
    return () => this.positionChangeListeners.delete(listenerId);
  }

  emitPositionChanged(positionMicroseconds) {
    for (const callback of [...this.positionChangeListeners.values()]) {
      try {
        callback(positionMicroseconds);
      } catch (error) {
        logger.errorOnce(
          "position-listener",
          "Position listener failed",
          error,
        );
      }
    }
  }

  destroy() {
    if (!this.propertiesProxy) return;
    this.positionRefreshGeneration++;
    this.positionChangeListeners.clear();
    this.positionRefreshPromise = null;
    this.operationCancellable = null;
    this.propertiesProxy = null;
    this.getMonotonicTime = null;
    this.getRealTime = null;
  }
}
