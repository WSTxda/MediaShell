/**
 * @file compatibility.js
 * @module shell.private.gnome.osd.compatibility
 *
 * Quarantines GNOME Shell's private OsdWindowManager contract.
 *
 * Shell 48 exposes show(monitorIndex, ...), where -1 targets every monitor.
 * Shell 49+ exposes showAll(...). Callers use feature detection here rather
 * than importing private Shell internals or branching on Shell versions.
 */

import * as Main from "resource:///org/gnome/shell/ui/main.js";

/** Shows one OSD through the native Shell manager on every monitor. */
export function showOsdOnAllMonitors(icon, label, level, maxLevel) {
  const manager = Main.osdWindowManager;
  if (!manager) return false;

  if (typeof manager.showAll === "function") {
    manager.showAll(icon, label, level, maxLevel);
    return true;
  }

  if (typeof manager.show === "function") {
    manager.show(-1, icon, label, level, maxLevel);
    return true;
  }

  return false;
}
