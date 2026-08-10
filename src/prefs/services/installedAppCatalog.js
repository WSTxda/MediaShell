/**
 * @file installedAppCatalog.js
 * @module prefs.services.installedAppCatalog
 *
 * Builds the searchable installed-application catalog used by blocked-app preferences.
 *
 * The catalog normalizes desktop IDs, names, and search aliases so the chooser
 * can match applications despite punctuation, accents, or desktop-file suffixes.
 * It is preferences-only and returns stable app metadata for BlockedAppsGroup.
 */

import Gio from "gi://Gio";

import { IconNames } from "../../shared/constants/icons.js";
import { buildBrowserIdentityAliases } from "../../shared/utils/browserIdentity.js";
import { createLogger } from "../../shared/utils/log.js";

const logger = createLogger("installedAppCatalog");
let fallbackAppIcon = null;

function getFallbackAppIcon() {
  fallbackAppIcon ??= Gio.ThemedIcon.new_from_names([
    IconNames.APP,
    IconNames.MISSING,
  ]);
  return fallbackAppIcon;
}

function readAppString(app, getterName) {
  return app ? String(app[getterName]() ?? "") : "";
}

/**
 * Reads a Gio.AppInfo desktop ID.
 *
 * @param {Gio.AppInfo|null|undefined} app - Application info object.
 * @returns {string} Desktop ID or an empty string.
 */
export function getAppId(app) {
  return app?.get_id() || "";
}

/**
 * Resolves the display name used in blocked-app rows.
 *
 * The function prefers the localized display name, falls back to the app name,
 * then to the desktop ID so every visible row has searchable text.
 *
 * @param {Gio.AppInfo|null|undefined} app - Application info object.
 * @param {string} fallback - Text used when the app exposes no usable name.
 * @returns {string} Best available application label.
 */
export function getAppName(app, fallback = "") {
  if (!app) return fallback;
  return app.get_display_name() || app.get_name() || getAppId(app) || fallback;
}

/**
 * Returns the Gio.Icon used by the blocked-app chooser.
 *
 * The original Gio.Icon is preserved because rebuilding themed icons from names
 * can lose desktop-file icon resolution details. The fallback is used only
 * when AppInfo exposes no icon.
 *
 * @param {Gio.AppInfo|null|undefined} app - Application info object.
 * @returns {Gio.Icon} App icon or a themed fallback.
 */
export function getAppIcon(app) {
  // Keep the original Gio.Icon object. Rebuilding a Gio.ThemedIcon from
  // its names can discard implementation details used by GTK to resolve
  // desktop-file icons and caused every chooser row to hit the fallback.
  return app?.get_icon() ?? getFallbackAppIcon();
}

/**
 * Builds pure desktop-app metadata used by identity and search helpers.
 *
 * The descriptor intentionally contains only strings so shared browser/PWA
 * resolution can score installed apps without importing Gio, GTK, or Shell.
 * Missing fields are treated as empty strings because AppInfo implementations
 * differ across desktop files and package formats.
 *
 * @param {Gio.AppInfo|null|undefined} app - Application info object.
 * @returns {{desktopId: string, startupWmClass: string, commandline: string}} Pure descriptor.
 */
function getAppDescriptor(app) {
  return {
    desktopId: getAppId(app),
    startupWmClass: readAppString(app, "get_startup_wm_class"),
    commandline: readAppString(app, "get_commandline"),
  };
}

/**
 * Builds additional search aliases for browser/PWA desktop entries.
 *
 * These aliases are not shown in the UI. They only let the blocked-app chooser
 * find PWA launchers by the same app ID evidence used by runtime identity
 * resolution.
 *
 * @param {Gio.AppInfo|null|undefined} app - Application info object.
 * @returns {string[]} Search aliases derived from browser/PWA metadata.
 */
export function getAppSearchAliases(app) {
  return buildBrowserIdentityAliases(getAppDescriptor(app));
}

/**
 * Enumerates installed applications with duplicate desktop IDs removed.
 *
 * The blocked-app chooser consumes this list as an in-memory catalog while the
 * dialog is open. Enumeration failures are recoverable because the rest of the
 * preferences window should remain usable.
 *
 * @returns {Gio.AppInfo[]} Installed applications with stable IDs.
 */
export function listInstalledApps() {
  try {
    const appsById = new Map();
    for (const app of Gio.AppInfo.get_all()) {
      const appId = getAppId(app);
      if (!appId || appsById.has(appId)) continue;
      appsById.set(appId, app);
    }
    return [...appsById.values()];
  } catch (error) {
    logger.warn("Installed apps could not be enumerated", error);
    return [];
  }
}
