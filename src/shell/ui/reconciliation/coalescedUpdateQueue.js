/**
 * @file coalescedUpdateQueue.js
 * @module shell.ui.reconciliation.coalescedUpdateQueue
 *
 * Coalesces dirty UI regions into one reconciliation at the next idle turn.
 *
 * Each surface owns its queue. This preserves MediaShell's burst coalescing
 * without coupling popup and top-bar presentation state through a global mask.
 */

import GLib from "gi://GLib";

/** Owns one GLib idle source and the dirty-region mask scheduled on it. */
export default class CoalescedUpdateQueue {
  constructor(reconcile, onError = null) {
    this.reconcile = reconcile;
    this.onError = onError;
    this.pendingRegions = 0;
    this.sourceId = null;
  }

  request(regions) {
    if (!this.reconcile || !regions) return;

    this.pendingRegions |= regions;
    if (this.sourceId !== null) return;

    this.sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this.sourceId = null;
      const pendingRegions = this.pendingRegions;
      this.pendingRegions = 0;
      if (!this.reconcile || !pendingRegions) return GLib.SOURCE_REMOVE;

      try {
        this.reconcile(pendingRegions);
      } catch (error) {
        this.onError?.(error);
      }
      return GLib.SOURCE_REMOVE;
    });
  }

  cancel() {
    if (this.sourceId !== null) {
      GLib.Source.remove(this.sourceId);
      this.sourceId = null;
    }
    this.pendingRegions = 0;
  }

  destroy() {
    this.cancel();
    this.reconcile = null;
    this.onError = null;
  }
}
