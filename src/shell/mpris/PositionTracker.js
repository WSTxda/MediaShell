// Tracks MPRIS position using explicit reads, Seeked signals, and monotonic-time estimation.
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { MPRIS_PLAYER_IFACE_NAME } from "../../shared/constants/dbus.js";
import { PlaybackStatus } from "../../shared/enums/MediaShellEnums.js";
import { createLogger } from "../../shared/utils/log.js";

Gio._promisify(Gio.DBusProxy.prototype, "call", "call_finish");

const logger = createLogger("PositionTracker");

function isCancellationError(error) {
    return Boolean(error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED));
}

function normalizePositionMicroseconds(value) {
    const position = Number(value);
    return Number.isFinite(position) ? Math.max(0, position) : 0;
}

export default class PositionTracker {
    constructor(propertiesProxy, operationCancellable = null) {
        this.propertiesProxy = propertiesProxy;
        this.operationCancellable = operationCancellable;
        this.positionMicroseconds = 0;
        this.playbackRate = 1;
        this.playbackStatus = PlaybackStatus.STOPPED;
        this.anchorMonotonicMicroseconds = GLib.get_monotonic_time();
        this.positionChangeListeners = new Map();
        this.nextPositionChangeListenerId = 1;
        this.destroyed = false;
        this.positionRefreshGeneration = 0;
        this.positionRefreshPromise = null;
    }

    updatePlaybackState(playbackStatus, playbackRate) {
        const currentPositionMicroseconds = this.getEstimatedPositionMicroseconds();
        this.positionMicroseconds = currentPositionMicroseconds;
        this.anchorMonotonicMicroseconds = GLib.get_monotonic_time();
        this.playbackStatus = playbackStatus ?? PlaybackStatus.STOPPED;
        this.playbackRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;

        if (this.playbackStatus !== PlaybackStatus.PLAYING)
            this.refreshPosition().catch((error) => {
                if (!isCancellationError(error))
                    logger.debugOnce("idle-position-refresh", "Position refresh failed while playback was idle", error);
            });
    }

    resetForTrackChange() {
        this.positionMicroseconds = 0;
        this.anchorMonotonicMicroseconds = GLib.get_monotonic_time();
        this.emitPositionChanged(0);
        this.refreshPosition(true).catch((error) => {
            if (!isCancellationError(error))
                logger.debugOnce("track-position-refresh", "Initial position refresh failed for a new track", error);
        });
    }

    handleSeeked(positionMicroseconds) {
        this.positionMicroseconds = normalizePositionMicroseconds(positionMicroseconds);
        this.anchorMonotonicMicroseconds = GLib.get_monotonic_time();
        this.emitPositionChanged(this.positionMicroseconds);
    }

    getEstimatedPositionMicroseconds() {
        if (this.playbackStatus !== PlaybackStatus.PLAYING) return this.positionMicroseconds;

        const elapsedMicroseconds = GLib.get_monotonic_time() - this.anchorMonotonicMicroseconds;
        return Math.max(0, this.positionMicroseconds + elapsedMicroseconds * this.playbackRate);
    }

    async getPositionMicroseconds() {
        try {
            await this.refreshPosition();
        } catch (error) {
            if (isCancellationError(error)) return this.getEstimatedPositionMicroseconds();
            // The monotonic estimate remains useful while a media app is busy or
            // disappearing from D-Bus, so a transient read failure is non-fatal.
            logger.debugOnce("estimated-position", "Using estimated position after a D-Bus read failed", error);
        }
        return this.getEstimatedPositionMicroseconds();
    }

    refreshPosition(force = false) {
        if (this.destroyed) return Promise.resolve(this.positionMicroseconds);
        if (this.positionRefreshPromise && !force) return this.positionRefreshPromise;

        const refreshGeneration = ++this.positionRefreshGeneration;
        const promise = this.readPositionMicroseconds(refreshGeneration).finally(() => {
            if (this.positionRefreshPromise === promise) this.positionRefreshPromise = null;
        });
        this.positionRefreshPromise = promise;
        return promise;
    }

    async readPositionMicroseconds(refreshGeneration) {
        const result = await this.propertiesProxy.call(
            "Get",
            new GLib.Variant("(ss)", [MPRIS_PLAYER_IFACE_NAME, "Position"]),
            Gio.DBusCallFlags.NONE,
            1000,
            this.operationCancellable,
        );

        if (this.destroyed || refreshGeneration !== this.positionRefreshGeneration) return this.positionMicroseconds;

        const value = result.get_child_value(0).get_variant();
        this.positionMicroseconds = normalizePositionMicroseconds(value.recursiveUnpack());
        this.anchorMonotonicMicroseconds = GLib.get_monotonic_time();
        return this.positionMicroseconds;
    }

    onPositionChanged(callback) {
        if (this.destroyed || typeof callback !== "function") return () => {};
        const listenerId = this.nextPositionChangeListenerId++;
        this.positionChangeListeners.set(listenerId, callback);
        return () => this.positionChangeListeners.delete(listenerId);
    }

    emitPositionChanged(positionMicroseconds) {
        for (const callback of [...this.positionChangeListeners.values()]) {
            try {
                callback(positionMicroseconds);
            } catch (error) {
                logger.errorOnce("position-listener", "Position listener failed", error);
            }
        }
    }

    destroy() {
        this.destroyed = true;
        this.positionRefreshGeneration++;
        this.positionChangeListeners.clear();
        this.positionRefreshPromise = null;
        this.operationCancellable = null;
        this.propertiesProxy = null;
    }
}
