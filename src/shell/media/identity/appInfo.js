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

/**
 * Returns a cached Shell.App/Gio.AppInfo only while its desktop ID remains
 * readable. Shell may invalidate application metadata independently of MPRIS,
 * so a stale cache entry must fall back to normal resolution instead of
 * poisoning every icon/name lookup for the endpoint.
 */
export function readCachedResolvedApp(cache, key) {
  const desktopApp = cache.get(key) ?? null;
  if (!desktopApp) return null;

  const appId = readAppStringSafely(() => desktopApp.get_id?.());
  if (appId) return desktopApp;
  cache.delete(key);
  return null;
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
