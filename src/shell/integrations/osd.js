/**
 * @file osd.js
 * @module shell.integrations.osd
 *
 * Feature-agnostic MediaShell boundary for transient GNOME Shell OSD presentation.
 *
 * Independent feedback features share this capability instead of owning Shell
 * internals or duplicating OSD presentation policy. Consumers provide simple
 * icon/label/level values; this integration creates the GIcon and contains
 * private Shell compatibility behind the adapter below. Presentation failures
 * are non-fatal and never affect media state.
 */

import Gio from "gi://Gio";

import { IconNames } from "../../shared/icons.js";
import { createLogger } from "../../shared/logging/logger.js";
import { showOsdOnAllMonitors } from "../private/gnome/osd/compatibility.js";

const logger = createLogger("OsdIntegration");

/** Presents transient feedback through GNOME Shell's native OSD manager. */
export default class OsdIntegration {
  show({ iconName, label = null, level = null, maxLevel = 1 } = {}) {
    const normalizedIconName =
      typeof iconName === "string" ? iconName.trim() : "";
    if (!normalizedIconName) return false;

    const normalizedLabel =
      typeof label === "string" && label.trim() ? label.trim() : null;
    const icon = Gio.ThemedIcon.new_from_names([
      normalizedIconName,
      IconNames.MISSING,
    ]);

    try {
      const shown = showOsdOnAllMonitors(
        icon,
        normalizedLabel,
        level,
        maxLevel,
      );
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
}
