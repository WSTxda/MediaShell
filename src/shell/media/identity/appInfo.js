/**
 * @file appInfo.js
 * @module shell.media.identity.appInfo
 *
 * Provides safe reads across Shell.App and Gio.AppInfo identity objects.
 *
 * GNOME may invalidate application metadata while a resolver is running. These
 * helpers keep that failure local and return stable string/null fallbacks so
 * presentation and browser/PWA matching can continue without tearing down the
 * MPRIS player.
 */

import { createLogger } from "../../../shared/logging/logger.js";

const logger = createLogger("DesktopAppInfo");

export function readAppStringSafely(getter) {
  try {
    return String(getter() ?? "");
  } catch (error) {
    logger.debugOnce(
      "app-metadata",
      "App metadata became unavailable during lookup",
      error,
    );
    return "";
  }
}

export function getAppInfoSafely(desktopApp) {
  try {
    return desktopApp?.get_app_info?.() ?? null;
  } catch (error) {
    logger.debugOnce(
      "app-info",
      "Desktop app metadata became unavailable during lookup",
      error,
    );
    return null;
  }
}

export function readDesktopAppDescriptor(desktopApp) {
  const appInfo = getAppInfoSafely(desktopApp) ?? desktopApp ?? null;
  return {
    desktopId: readAppStringSafely(
      () => desktopApp?.get_id?.() || appInfo?.get_id?.(),
    ),
    startupWmClass: readAppStringSafely(
      () =>
        desktopApp?.get_startup_wm_class?.() ||
        appInfo?.get_startup_wm_class?.(),
    ),
    commandline: readAppStringSafely(
      () => desktopApp?.get_commandline?.() || appInfo?.get_commandline?.(),
    ),
  };
}

export function readDesktopAppIcon(desktopApp) {
  if (!desktopApp) return null;

  const directIcon = desktopApp.get_icon?.();
  if (directIcon) return directIcon;
  return getAppInfoSafely(desktopApp)?.get_icon?.() ?? null;
}
