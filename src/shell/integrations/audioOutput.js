/**
 * @file audioOutput.js
 * @module shell.integrations.audioOutput
 *
 * Owns MediaShell's system audio-output switching capability.
 *
 * GVC is the same audio abstraction GNOME Shell uses for its output chooser.
 * This integration keeps one session-scoped MixerControl for the user-session
 * lifecycle, tracks only UI-visible outputs, and confirms requested changes
 * from GVC's active-output signal before reporting success to callers.
 */

import GLib from "gi://GLib";
import Gvc from "gi://Gvc";

import { createLogger } from "../../shared/logging/logger.js";

const logger = createLogger("AudioOutput");
const OUTPUT_CHANGE_TIMEOUT_MS = 2500;

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Tracks available audio outputs and switches the system default output.
 */
export default class AudioOutputIntegration {
  constructor() {
    this.control = new Gvc.MixerControl({
      name: "MediaShell Audio Output Control",
    });
    this.outputs = new Map();
    this.activeOutputId = null;
    this.pendingChange = null;
    this.signalIds = [];

    this.signalIds.push(
      this.control.connect("output-added", (_control, id) =>
        this.addOutput(id),
      ),
      this.control.connect("output-removed", (_control, id) =>
        this.removeOutput(id),
      ),
      this.control.connect("active-output-update", (_control, id) =>
        this.handleActiveOutputChanged(id),
      ),
      this.control.connect("state-changed", () =>
        this.handleControlStateChanged(),
      ),
    );

    this.control.open();
  }

  addOutput(id) {
    const device = this.control?.lookup_output_id(id) ?? null;
    if (device) this.outputs.set(id, device);
  }

  removeOutput(id) {
    this.outputs.delete(id);
    if (this.activeOutputId === id) this.activeOutputId = null;
    if (this.pendingChange?.targetId === id) this.finishPendingChange(null);
  }

  handleControlStateChanged() {
    if (!this.control) return;
    if (this.control.get_state() !== Gvc.MixerControlState.READY) {
      this.finishPendingChange(null);
      this.outputs.clear();
      this.activeOutputId = null;
      return;
    }

    this.syncActiveOutput();
  }

  syncActiveOutput() {
    if (!this.control) return;
    if (this.control.get_state() !== Gvc.MixerControlState.READY) {
      this.activeOutputId = null;
      return;
    }

    const sink = this.control.get_default_sink();
    const device = sink ? this.control.lookup_device_from_stream(sink) : null;
    this.activeOutputId = device?.get_id() ?? null;
  }

  handleActiveOutputChanged(id) {
    this.activeOutputId = id;
    if (this.pendingChange?.targetId !== id) return;

    const device =
      this.outputs.get(id) ?? this.control?.lookup_output_id(id) ?? null;
    this.finishPendingChange(
      device ? this.createOutputSnapshot(id, device) : null,
    );
  }

  createOutputSnapshot(id, device) {
    const description = normalizeText(device.get_description());
    const origin = normalizeText(device.get_origin());

    return Object.freeze({
      id,
      description,
      origin,
      label:
        description && origin
          ? `${description} – ${origin}`
          : description || origin,
      gicon: device.get_gicon(),
    });
  }

  getActiveOutputId() {
    if (this.activeOutputId !== null) return this.activeOutputId;
    this.syncActiveOutput();
    return this.activeOutputId;
  }

  /**
   * Switches to the next available output and resolves only after GVC confirms
   * that output as active. A newer request supersedes an older pending request.
   */
  switchToNext() {
    if (
      !this.control ||
      this.control.get_state() !== Gvc.MixerControlState.READY ||
      this.outputs.size < 2
    )
      return Promise.resolve(null);

    const outputIds = [...this.outputs.keys()];
    const cursorId = this.pendingChange?.targetId ?? this.getActiveOutputId();
    const cursorIndex = outputIds.indexOf(cursorId);
    const targetId = outputIds[(cursorIndex + 1) % outputIds.length];
    const target = this.outputs.get(targetId);
    if (!target) return Promise.resolve(null);

    this.finishPendingChange(null);

    return new Promise((resolve) => {
      const pendingChange = {
        targetId,
        resolve,
        timeoutId: null,
      };
      pendingChange.timeoutId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        OUTPUT_CHANGE_TIMEOUT_MS,
        () => {
          pendingChange.timeoutId = null;
          if (this.pendingChange === pendingChange)
            this.finishPendingChange(null);
          return GLib.SOURCE_REMOVE;
        },
      );
      this.pendingChange = pendingChange;

      try {
        this.control.change_output(target);
      } catch (error) {
        logger.warn("Failed to change the audio output", error);
        this.finishPendingChange(null);
        return;
      }

      // GVC normally emits active-output-update, but keep synchronous changes
      // correct if a backend reports the new default before returning here.
      this.syncActiveOutput();
      if (this.activeOutputId === targetId) {
        const device =
          this.outputs.get(targetId) ??
          this.control?.lookup_output_id(targetId) ??
          null;
        this.finishPendingChange(
          device ? this.createOutputSnapshot(targetId, device) : null,
        );
      }
    });
  }

  finishPendingChange(result) {
    const pendingChange = this.pendingChange;
    if (!pendingChange) return;

    this.pendingChange = null;
    if (pendingChange.timeoutId !== null) {
      GLib.Source.remove(pendingChange.timeoutId);
      pendingChange.timeoutId = null;
    }
    pendingChange.resolve(result);
  }

  destroy() {
    this.finishPendingChange(null);

    if (this.control) {
      for (const signalId of this.signalIds.splice(0)) {
        try {
          this.control.disconnect(signalId);
        } catch (error) {
          logger.warn("Failed to disconnect audio output signal", error);
        }
      }

      try {
        this.control.close();
      } catch (error) {
        logger.warn("Failed to close audio output control", error);
      }
    }

    this.outputs.clear();
    this.activeOutputId = null;
    this.control = null;
  }
}
