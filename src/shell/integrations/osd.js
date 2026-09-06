/**
 * @file osd.js
 * @module shell.integrations.osd
 *
 * Feature-agnostic MediaShell boundary for transient GNOME Shell OSD presentation.
 *
 * Independent feedback features share this capability instead of owning Shell
 * internals or duplicating OSD presentation policy. Consumers provide simple
 * icon/label/level values; this integration accepts either a resolved GIcon or
 * a themed icon name and contains private Shell compatibility behind the adapter
 * below. Presentation failures
 * are non-fatal and never affect media state.
 */

import Gio from "gi://Gio";

import { createLogger } from "../../shared/logging/logger.js";
import { showOsdOnAllMonitors } from "../private/gnome/osd/compatibility.js";

const logger = createLogger("Osd");

/** Presents transient feedback through GNOME Shell's native OSD manager. */
export function showOsd({
  gicon = null,
  iconName = null,
  label = null,
  level = null,
  maxLevel = 1,
} = {}) {
  const normalizedIconName =
    typeof iconName === "string" ? iconName.trim() : "";
  const icon =
    gicon ??
    (normalizedIconName
      ? Gio.ThemedIcon.new_from_names([
          normalizedIconName,
          "image-missing-symbolic",
        ])
      : null);
  if (!icon) return false;

  const normalizedLabel =
    typeof label === "string" && label.trim() ? label.trim() : null;

  try {
    const shown = showOsdOnAllMonitors(icon, normalizedLabel, level, maxLevel);
    if (!shown)
      logger.warnOnce(
        "unavailable",
        "GNOME Shell OSD integration is unavailable; feedback will be skipped",
      );
    return shown;
  } catch (error) {
    logger.warnOnce(
      `show:${error?.name ?? "Error"}`,
      "GNOME Shell OSD presentation failed; feedback will be skipped",
      error,
    );
    return false;
  }
}
