/**
 * @file desktopAppResolver.js
 * @module shell.media.identity.desktopAppResolver
 *
 * Resolves MPRIS identity hints to installed desktop applications.
 *
 * One MediaRuntime-owned instance owns bounded Shell.App and Gio.AppInfo
 * caches. Misses use a short TTL so unresolved browser/PWA identities can be
 * retried when desktop metadata appears later. Teardown releases cached
 * Shell.App and Gio.AppInfo references.
 *
 * @see src/shell/media/identity/appIdentity.js
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Shell from "gi://Shell";

import { IconNames } from "../../../shared/icons.js";
import {
  DESKTOP_APP_RESOLVER_CACHE_LIMIT,
  DESKTOP_APP_RESOLVER_MISS_CACHE_TTL_MS,
} from "./constants.js";
import {
  buildAppLookupHints,
  buildDesktopAppIdCandidates,
  buildNormalizedAppIdentityCandidates,
  normalizeAppIdentity,
  normalizedIdentityContains,
  stripDesktopFileSuffix,
} from "./appIdentity.js";
import {
  getAppInfoSafely,
  readAppStringSafely,
  readCachedResolvedApp,
  readDesktopAppIcon,
} from "./appInfo.js";
import {
  resolveChromiumAppInfo,
  resolveChromiumShellApp,
} from "./pwa/chromium.js";
import { createLogger } from "../../../shared/logging/logger.js";

const logger = createLogger("DesktopAppResolver");

function createAppCacheKey(identity, desktopEntry, busName) {
  return `${String(desktopEntry ?? "")}\u0000${String(identity ?? "")}\u0000${String(busName ?? "")}`;
}

function storeBoundedCacheValue(cache, key, value) {
  if (!value) return value;
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > DESKTOP_APP_RESOLVER_CACHE_LIMIT)
    cache.delete(cache.keys().next().value);
  return value;
}

function getNormalizedAppIdentityValues(desktopApp) {
  const appInfo = getAppInfoSafely(desktopApp);
  return [
    readAppStringSafely(() => desktopApp.get_id?.()),
    readAppStringSafely(() => desktopApp.get_name?.()),
    readAppStringSafely(() => desktopApp.get_display_name?.()),
    readAppStringSafely(() => desktopApp.get_executable?.()),
    readAppStringSafely(() => desktopApp.get_startup_wm_class?.()),
    readAppStringSafely(() => appInfo?.get_id?.()),
    readAppStringSafely(() => appInfo?.get_name?.()),
    readAppStringSafely(() => appInfo?.get_display_name?.()),
    readAppStringSafely(() => appInfo?.get_executable?.()),
    readAppStringSafely(() => appInfo?.get_startup_wm_class?.()),
  ]
    .map(normalizeAppIdentity)
    .filter(Boolean);
}

function appMatchesIdentityCandidates(desktopApp, normalizedCandidates) {
  if (!desktopApp || normalizedCandidates.length === 0) return false;

  const normalizedAppValues = getNormalizedAppIdentityValues(desktopApp);
  return normalizedCandidates.some((candidate) =>
    normalizedAppValues.some((appValue) =>
      normalizedIdentityContains(appValue, candidate),
    ),
  );
}

function findRunningShellApp(runningApps, normalizedCandidates) {
  for (const desktopApp of runningApps) {
    if (appMatchesIdentityCandidates(desktopApp, normalizedCandidates))
      return desktopApp;
  }
  return null;
}

function flattenSearchResultGroups(resultGroups) {
  const appIds = [];
  for (const resultGroup of resultGroups ?? []) {
    if (Array.isArray(resultGroup)) appIds.push(...resultGroup);
    else if (resultGroup) appIds.push(resultGroup);
  }
  return appIds;
}

function findShellAppFromSearch(
  appSystem,
  lookupHints,
  normalizedCandidates,
  runningAppsById,
) {
  for (const lookupHint of lookupHints) {
    let resultGroups;
    try {
      resultGroups = Shell.AppSystem.search(lookupHint);
    } catch (error) {
      logger.debugOnce(
        "app-search",
        "Shell app search failed during MPRIS lookup",
        error,
      );
      continue;
    }

    for (const appId of flattenSearchResultGroups(resultGroups)) {
      const normalizedAppId = String(appId);
      const desktopApp =
        runningAppsById.get(normalizedAppId) ??
        appSystem.lookup_app(normalizedAppId);
      if (appMatchesIdentityCandidates(desktopApp, normalizedCandidates))
        return desktopApp;
    }
  }
  return null;
}

function findShellAppByHeuristicLookup(appSystem, lookupHints) {
  const lookupMethods = [
    "lookup_heuristic_basename",
    "lookup_desktop_wmclass",
    "lookup_startup_wmclass",
  ];
  for (const lookupHint of lookupHints) {
    for (const methodName of lookupMethods) {
      const lookup = appSystem[methodName];
      if (typeof lookup !== "function") continue;
      try {
        const desktopApp = lookup.call(appSystem, lookupHint);
        if (desktopApp) return desktopApp;
      } catch (error) {
        logger.debugOnce(
          `app-${methodName}`,
          `Shell ${methodName} lookup failed`,
          error,
        );
      }
    }
  }
  return null;
}

/**
 * Resolves MPRIS identity hints to installed desktop applications.
 */
export default class DesktopAppResolver {
  #fallbackDesktopAppIcon = null;
  #shellAppCache = new Map();
  #appInfoCache = new Map();
  #missCache = new Map();

  #findShellApp(identity, desktopEntry, busName = "") {
    const appCacheKey = createAppCacheKey(identity, desktopEntry, busName);
    const cachedApp = readCachedResolvedApp(this.#shellAppCache, appCacheKey);
    if (cachedApp) return cachedApp;

    try {
      const appSystem = Shell.AppSystem.get_default();
      let runningApps = null;
      const chromiumPwaApp = resolveChromiumShellApp(
        appSystem,
        identity,
        desktopEntry,
        busName,
      );
      if (chromiumPwaApp)
        return storeBoundedCacheValue(
          this.#shellAppCache,
          appCacheKey,
          chromiumPwaApp,
        );

      const appIdCandidates = buildDesktopAppIdCandidates(
        identity,
        desktopEntry,
        busName,
      );
      for (const appIdCandidate of appIdCandidates) {
        const desktopApp = appSystem.lookup_app(appIdCandidate);
        if (desktopApp)
          return storeBoundedCacheValue(
            this.#shellAppCache,
            appCacheKey,
            desktopApp,
          );
      }

      const normalizedCandidates = buildNormalizedAppIdentityCandidates(
        identity,
        desktopEntry,
        busName,
      );
      runningApps ??= appSystem.get_running();

      const runningApp = findRunningShellApp(runningApps, normalizedCandidates);
      if (runningApp)
        return storeBoundedCacheValue(
          this.#shellAppCache,
          appCacheKey,
          runningApp,
        );

      const lookupHints = buildAppLookupHints(identity, desktopEntry, busName);
      const heuristicApp = findShellAppByHeuristicLookup(
        appSystem,
        lookupHints,
      );
      if (heuristicApp)
        return storeBoundedCacheValue(
          this.#shellAppCache,
          appCacheKey,
          heuristicApp,
        );

      const runningAppsById = new Map(
        runningApps
          .map((desktopApp) => [
            readAppStringSafely(() => desktopApp.get_id()),
            desktopApp,
          ])
          .filter(([appId]) => Boolean(appId)),
      );
      const searchedApp = findShellAppFromSearch(
        appSystem,
        lookupHints,
        normalizedCandidates,
        runningAppsById,
      );
      if (searchedApp)
        return storeBoundedCacheValue(
          this.#shellAppCache,
          appCacheKey,
          searchedApp,
        );
    } catch (error) {
      logger.warnOnce(
        "shell-app-enumeration",
        "Failed to inspect Shell apps; trying desktop app metadata",
        error,
      );
    }

    // Misses are deliberately not cached. Browser endpoints can appear before
    // Shell.AppSystem has associated their desktop app, so a later UI refresh
    // must be able to resolve the real icon instead of retaining a fallback.
    return null;
  }

  #findAppInfo(identity, desktopEntry, busName = "") {
    const appCacheKey = createAppCacheKey(identity, desktopEntry, busName);
    const cachedApp = readCachedResolvedApp(this.#appInfoCache, appCacheKey);
    if (cachedApp) return cachedApp;

    try {
      const chromiumPwaApp = resolveChromiumAppInfo(
        identity,
        desktopEntry,
        busName,
      );
      if (chromiumPwaApp)
        return storeBoundedCacheValue(
          this.#appInfoCache,
          appCacheKey,
          chromiumPwaApp,
        );

      const appIdCandidates = buildDesktopAppIdCandidates(
        identity,
        desktopEntry,
        busName,
      );
      for (const appIdCandidate of appIdCandidates) {
        const desktopApp = Gio.DesktopAppInfo.new(appIdCandidate);
        if (desktopApp)
          return storeBoundedCacheValue(
            this.#appInfoCache,
            appCacheKey,
            desktopApp,
          );
      }

      const candidateAppIdSet = new Set(appIdCandidates);

      const normalizedCandidates = buildNormalizedAppIdentityCandidates(
        identity,
        desktopEntry,
        busName,
      );
      for (const desktopApp of Gio.AppInfo.get_all()) {
        const appId = readAppStringSafely(() => desktopApp.get_id());
        if (candidateAppIdSet.has(appId))
          return storeBoundedCacheValue(
            this.#appInfoCache,
            appCacheKey,
            desktopApp,
          );
        if (appMatchesIdentityCandidates(desktopApp, normalizedCandidates))
          return storeBoundedCacheValue(
            this.#appInfoCache,
            appCacheKey,
            desktopApp,
          );
      }
    } catch (error) {
      logger.warnOnce(
        "desktop-app-enumeration",
        "Failed to inspect desktop apps",
        error,
      );
    }

    return null;
  }

  resolveShellApp(identity, desktopEntry, busName = "") {
    return this.#findShellApp(identity, desktopEntry, busName);
  }

  // Lifecycle decisions intentionally accept only the exact MPRIS DesktopEntry.
  // Identity, bus-name, WM-class, running-app and search heuristics are suitable
  // for presentation, but are not strong enough evidence to destroy an MPRIS player.
  resolveLifecycleShellApp(desktopEntry) {
    const desktopFileBasename = stripDesktopFileSuffix(desktopEntry);
    if (!desktopFileBasename) return null;

    const appSystem = Shell.AppSystem.get_default();
    return (
      appSystem.lookup_app(`${desktopFileBasename}.desktop`) ??
      appSystem.lookup_app(desktopFileBasename) ??
      null
    );
  }

  isShellAppStopped(shellApp) {
    return Boolean(shellApp && shellApp.get_state() === Shell.AppState.STOPPED);
  }

  #isRecentMiss(appCacheKey) {
    const missTime = this.#missCache.get(appCacheKey);
    if (missTime === undefined) return false;

    const elapsed = GLib.get_monotonic_time() / 1000 - missTime;
    if (elapsed < DESKTOP_APP_RESOLVER_MISS_CACHE_TTL_MS) return true;

    this.#missCache.delete(appCacheKey);
    return false;
  }

  #recordMiss(appCacheKey) {
    this.#missCache.set(appCacheKey, GLib.get_monotonic_time() / 1000);
  }

  resolveDesktopApp(identity, desktopEntry, busName = "") {
    const appCacheKey = createAppCacheKey(identity, desktopEntry, busName);

    if (this.#isRecentMiss(appCacheKey)) return null;

    const desktopApp =
      this.resolveShellApp(identity, desktopEntry, busName) ??
      this.#findAppInfo(identity, desktopEntry, busName);

    if (!desktopApp) {
      this.#recordMiss(appCacheKey);
      logger.debugOnce(
        `unresolved:${appCacheKey}`,
        "Desktop app identity is not resolved yet",
        busName || "unknown bus",
        desktopEntry || identity || "unknown identity",
      );
    }
    return desktopApp;
  }

  #getFallbackDesktopAppIcon() {
    this.#fallbackDesktopAppIcon ??= Gio.ThemedIcon.new_from_names([
      IconNames.MEDIA,
      IconNames.MISSING,
    ]);
    return this.#fallbackDesktopAppIcon;
  }

  getDesktopAppIcon(desktopApp) {
    try {
      return (
        readDesktopAppIcon(desktopApp) ?? this.#getFallbackDesktopAppIcon()
      );
    } catch (error) {
      logger.debugOnce(
        "desktop-app-icon",
        "The app icon could not be read; using the fallback",
        error,
      );
      return this.#getFallbackDesktopAppIcon();
    }
  }

  hasResolvedDesktopAppIcon(desktopApp) {
    try {
      return Boolean(readDesktopAppIcon(desktopApp));
    } catch (error) {
      logger.debugOnce(
        "desktop-app-icon-resolution",
        "The app icon is not available yet",
        error,
      );
      return false;
    }
  }

  getDesktopAppName(desktopApp, fallback) {
    try {
      const appInfo = getAppInfoSafely(desktopApp);
      return (
        desktopApp?.get_display_name?.() ||
        desktopApp?.get_name?.() ||
        appInfo?.get_display_name?.() ||
        appInfo?.get_name?.() ||
        fallback
      );
    } catch (error) {
      logger.debugOnce(
        "desktop-app-name",
        "The app name could not be read; using the MPRIS identity",
        error,
      );
      return fallback;
    }
  }

  isPlayerBlocked(identity, desktopEntry, blockedAppIds, busName = "") {
    const blockedAppIdSet =
      blockedAppIds instanceof Set
        ? blockedAppIds
        : new Set(blockedAppIds ?? []);
    if (blockedAppIdSet.size === 0) return false;

    const appIdCandidates = buildDesktopAppIdCandidates(
      identity,
      desktopEntry,
      busName,
    );
    if (appIdCandidates.some((appId) => blockedAppIdSet.has(appId)))
      return true;

    const desktopApp = this.resolveDesktopApp(identity, desktopEntry, busName);
    const appId = readAppStringSafely(() => desktopApp?.get_id?.());
    return Boolean(appId && blockedAppIdSet.has(appId));
  }

  destroy() {
    this.#shellAppCache.clear();
    this.#appInfoCache.clear();
    this.#missCache.clear();
    this.#fallbackDesktopAppIcon = null;
  }
}
