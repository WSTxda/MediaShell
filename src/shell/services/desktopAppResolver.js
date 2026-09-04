/**
 * @file desktopAppResolver.js
 * @module shell.services.desktopAppResolver
 *
 * Resolves MPRIS identity hints to installed desktop applications.
 *
 * One ExtensionController-owned instance owns bounded Shell.App and Gio.AppInfo
 * caches. Misses use a short TTL so unresolved browser/PWA identities can be
 * retried when desktop metadata appears later. Teardown releases cached
 * Shell.App and Gio.AppInfo references.
 *
 * @see src/shell/media/identity/appIdentity.js
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Shell from "gi://Shell";

import {
  resolveBrowserIdentityCandidate,
  resolveChromiumPwaAppId,
} from "../../shared/identity/browser.js";
import { IconNames } from "../../shared/icons.js";
import {
  DESKTOP_APP_RESOLVER_CACHE_LIMIT,
  DESKTOP_APP_RESOLVER_MISS_CACHE_TTL_MS,
} from "../constants/desktopApp.js";
import {
  buildAppLookupHints,
  buildDesktopAppIdCandidates,
  buildNormalizedAppIdentityCandidates,
  normalizeAppIdentity,
  stripDesktopFileSuffix,
} from "../media/identity/appIdentity.js";
import { createLogger } from "../../shared/logging/logger.js";

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

function readAppStringSafely(getter) {
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

function readCachedResolvedApp(cache, key) {
  const desktopApp = cache.get(key) ?? null;
  if (!desktopApp) return null;

  // A cached Shell.App or Gio.AppInfo remains useful after its windows close,
  // but discard an object whose desktop ID can no longer be read.
  const appId = readAppStringSafely(() => desktopApp.get_id?.());
  if (appId) return desktopApp;
  cache.delete(key);
  return null;
}

function normalizedIdentityContains(normalizedValue, normalizedCandidate) {
  if (normalizedValue === normalizedCandidate) return true;
  if (normalizedCandidate.length < 3 || normalizedValue.length < 3)
    return false;

  const paddedValue = ` ${normalizedValue} `;
  const paddedCandidate = ` ${normalizedCandidate} `;
  return (
    paddedValue.includes(paddedCandidate) ||
    paddedCandidate.includes(paddedValue)
  );
}

function getAppInfoSafely(desktopApp) {
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

function createMediaIdentityDescriptor(identity, desktopEntry, busName) {
  return { identity, desktopEntry, busName };
}

function buildExactDesktopEntryCandidates(desktopEntry) {
  const basename = stripDesktopFileSuffix(desktopEntry);
  return basename ? [`${basename}.desktop`, basename] : [];
}

function findShellAppByExactDesktopEntry(appSystem, desktopEntry) {
  for (const appId of buildExactDesktopEntryCandidates(desktopEntry)) {
    const desktopApp = appSystem.lookup_app(appId);
    if (desktopApp) return desktopApp;
  }
  return null;
}

function findAppInfoByExactDesktopEntry(desktopEntry) {
  for (const appId of buildExactDesktopEntryCandidates(desktopEntry)) {
    const desktopApp = Gio.DesktopAppInfo.new(appId);
    if (desktopApp) return desktopApp;
  }
  return null;
}

/**
 * Reads installed-app metadata into the pure descriptor used by browser/PWA scoring.
 *
 * Shell.App and Gio.AppInfo expose overlapping but not identical accessors. The
 * resolver keeps the read side here and passes only strings to shared identity
 * helpers so browser matching remains testable outside GNOME Shell.
 *
 * @param {Shell.App|Gio.AppInfo|null} desktopApp - Shell or desktop app object.
 * @returns {object} Descriptor accepted by shared browser identity helpers.
 */
function readDesktopAppDescriptor(desktopApp) {
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

/**
 * Resolves a media app against scored browser/PWA candidates.
 *
 * The shared scorer returns a match only for strong evidence in the desktop ID,
 * StartupWMClass, or Chromium's explicit `--app-id` launcher argument. Ordinary
 * browser media keeps the existing resolver fallback path.
 *
 * @param {object} mediaIdentity - MPRIS identity, desktop entry, and bus name.
 * @param {{desktopApp: Shell.App|Gio.AppInfo}[]} entries
 *   Installed desktop app candidates.
 * @returns {Shell.App|Gio.AppInfo|null} Strongly matched desktop app, if any.
 */
function resolveBrowserIdentityApp(mediaIdentity, entries) {
  const descriptorEntries = entries
    .map((entry) => ({
      ...entry,
      descriptor: readDesktopAppDescriptor(entry.desktopApp),
    }))
    .filter((entry) => entry.descriptor.desktopId);
  const match = resolveBrowserIdentityCandidate(
    mediaIdentity,
    descriptorEntries.map((entry) => entry.descriptor),
  );
  if (!match) return null;

  const entry =
    descriptorEntries.find(
      (candidate) => candidate.descriptor === match.descriptor,
    ) ?? null;
  if (!entry) return null;

  return entry.desktopApp;
}

/**
 * Finds a Shell.App for browser/PWA media before fuzzy name matching runs.
 *
 * Running and installed apps are evaluated as one desktop-ID-keyed set. Runtime
 * state is not identity evidence: two installed launchers with equally strong
 * metadata remain ambiguous even when only one currently has an open window.
 */
function findShellAppByBrowserIdentity(
  appSystem,
  runningApps,
  identity,
  desktopEntry,
  busName,
) {
  const desktopAppsById = new Map();
  for (const desktopApp of runningApps) {
    const appId = readAppStringSafely(() => desktopApp.get_id?.());
    if (appId) desktopAppsById.set(appId, desktopApp);
  }
  for (const desktopApp of Gio.AppInfo.get_all()) {
    const appId = readAppStringSafely(() => desktopApp.get_id?.());
    if (appId && !desktopAppsById.has(appId))
      desktopAppsById.set(appId, desktopApp);
  }

  const match = resolveBrowserIdentityApp(
    createMediaIdentityDescriptor(identity, desktopEntry, busName),
    [...desktopAppsById.values()].map((desktopApp) => ({ desktopApp })),
  );
  const appId = readAppStringSafely(() => match?.get_id?.());
  if (!appId) return null;

  return appSystem.lookup_app(appId) ?? desktopAppsById.get(appId) ?? null;
}

/**
 * Finds Gio.AppInfo for browser/PWA media when Shell.App resolution misses.
 *
 * This preserves icons and display names for desktop entries that are known to
 * Gio but not currently associated with a running Shell.App.
 */
function findAppInfoByBrowserIdentity(identity, desktopEntry, busName) {
  return resolveBrowserIdentityApp(
    createMediaIdentityDescriptor(identity, desktopEntry, busName),
    Gio.AppInfo.get_all().map((desktopApp) => ({ desktopApp })),
  );
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

function readDesktopAppIcon(desktopApp) {
  if (!desktopApp) return null;

  const directIcon = desktopApp.get_icon?.();
  if (directIcon) return directIcon;
  return getAppInfoSafely(desktopApp)?.get_icon?.() ?? null;
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
      const mediaIdentity = createMediaIdentityDescriptor(
        identity,
        desktopEntry,
        busName,
      );
      const pwaAppId = resolveChromiumPwaAppId(mediaIdentity);
      if (pwaAppId && resolveChromiumPwaAppId({ desktopEntry }) === pwaAppId) {
        const exactDesktopApp = findShellAppByExactDesktopEntry(
          appSystem,
          desktopEntry,
        );
        if (exactDesktopApp)
          return storeBoundedCacheValue(
            this.#shellAppCache,
            appCacheKey,
            exactDesktopApp,
          );
      }

      if (pwaAppId) {
        runningApps = appSystem.get_running();
        const browserIdentityApp = findShellAppByBrowserIdentity(
          appSystem,
          runningApps,
          identity,
          desktopEntry,
          busName,
        );
        if (browserIdentityApp)
          return storeBoundedCacheValue(
            this.#shellAppCache,
            appCacheKey,
            browserIdentityApp,
          );
      }

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
      const mediaIdentity = createMediaIdentityDescriptor(
        identity,
        desktopEntry,
        busName,
      );
      const pwaAppId = resolveChromiumPwaAppId(mediaIdentity);
      if (pwaAppId && resolveChromiumPwaAppId({ desktopEntry }) === pwaAppId) {
        const exactDesktopApp = findAppInfoByExactDesktopEntry(desktopEntry);
        if (exactDesktopApp)
          return storeBoundedCacheValue(
            this.#appInfoCache,
            appCacheKey,
            exactDesktopApp,
          );
      }

      if (pwaAppId) {
        const browserIdentityApp = findAppInfoByBrowserIdentity(
          identity,
          desktopEntry,
          busName,
        );
        if (browserIdentityApp)
          return storeBoundedCacheValue(
            this.#appInfoCache,
            appCacheKey,
            browserIdentityApp,
          );
      }

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
  // for presentation, but are not strong enough evidence to destroy a media app.
  resolveLifecycleShellApp(desktopEntry) {
    const desktopFileBasename = stripDesktopFileSuffix(desktopEntry);
    if (!desktopFileBasename) return null;

    try {
      const appSystem = Shell.AppSystem.get_default();
      return (
        appSystem.lookup_app(`${desktopFileBasename}.desktop`) ??
        appSystem.lookup_app(desktopFileBasename) ??
        null
      );
    } catch (error) {
      logger.debugOnce(
        `lifecycle-app:${desktopFileBasename}`,
        "The exact MPRIS desktop entry could not be resolved for lifecycle observation",
        error,
      );
      return null;
    }
  }

  isShellAppStopped(shellApp) {
    if (!shellApp || typeof shellApp.get_state !== "function") return false;

    try {
      return shellApp.get_state() === Shell.AppState.STOPPED;
    } catch (error) {
      logger.debugOnce(
        "lifecycle-app-state",
        "Shell app state became unavailable during cleanup",
        error,
      );
      return false;
    }
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

    if (!desktopApp) this.#recordMiss(appCacheKey);
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

  isMediaAppBlocked(identity, desktopEntry, blockedAppIds, busName = "") {
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
