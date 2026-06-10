// Resolves MPRIS identity hints to installed apps while caching only stable successful matches.
import Gio from "gi://Gio";
import Shell from "gi://Shell";

import { IconNames } from "../../shared/constants/icons.js";
import {
    buildAppLookupHints,
    buildDesktopAppIdCandidates,
    buildNormalizedAppIdentityCandidates,
    normalizeAppIdentity,
    stripDesktopFileSuffix,
} from "../../shared/utils/appIdentity.js";
import { createLogger } from "../../shared/utils/log.js";

const logger = createLogger("MediaAppResolver");

let fallbackMediaAppIcon = null;
export const FALLBACK_MEDIA_APP_ICON_NAME = IconNames.MEDIA;

const CACHE_LIMIT = 128;
const shellAppCache = new Map();
const appInfoCache = new Map();

function createAppCacheKey(identity, desktopEntry, busName) {
    return `${String(desktopEntry ?? "")}\u0000${String(identity ?? "")}\u0000${String(busName ?? "")}`;
}

function storeBoundedCacheValue(cache, key, value) {
    if (!value) return value;
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return value;
}

function readAppStringSafely(getter) {
    try {
        return String(getter() ?? "");
    } catch (error) {
        logger.debugOnce("app-metadata", "App metadata became unavailable during lookup", error);
        return "";
    }
}

function readCachedResolvedApp(cache, key) {
    const app = cache.get(key) ?? null;
    if (!app) return null;

    // A cached Shell.App or Gio.AppInfo remains useful after its windows close,
    // but discard an object whose desktop ID can no longer be read.
    const appId = readAppStringSafely(() => app.get_id?.());
    if (appId) return app;
    cache.delete(key);
    return null;
}

function normalizedIdentityContains(normalizedValue, normalizedCandidate) {
    if (normalizedValue === normalizedCandidate) return true;
    if (normalizedCandidate.length < 3 || normalizedValue.length < 3) return false;

    const paddedValue = ` ${normalizedValue} `;
    const paddedCandidate = ` ${normalizedCandidate} `;
    return paddedValue.includes(paddedCandidate) || paddedCandidate.includes(paddedValue);
}

function getAppInfoSafely(app) {
    try {
        return app?.get_app_info?.() ?? null;
    } catch (error) {
        logger.debugOnce("app-info", "Desktop app metadata became unavailable during lookup", error);
        return null;
    }
}

function getNormalizedAppIdentityValues(app) {
    const appInfo = getAppInfoSafely(app);
    return [
        readAppStringSafely(() => app.get_id?.()),
        readAppStringSafely(() => app.get_name?.()),
        readAppStringSafely(() => app.get_display_name?.()),
        readAppStringSafely(() => app.get_executable?.()),
        readAppStringSafely(() => app.get_startup_wm_class?.()),
        readAppStringSafely(() => appInfo?.get_id?.()),
        readAppStringSafely(() => appInfo?.get_name?.()),
        readAppStringSafely(() => appInfo?.get_display_name?.()),
        readAppStringSafely(() => appInfo?.get_executable?.()),
        readAppStringSafely(() => appInfo?.get_startup_wm_class?.()),
    ]
        .map(normalizeAppIdentity)
        .filter(Boolean);
}

function appMatchesIdentityCandidates(app, normalizedCandidates) {
    if (!app || normalizedCandidates.length === 0) return false;

    const normalizedAppValues = getNormalizedAppIdentityValues(app);
    return normalizedCandidates.some((candidate) =>
        normalizedAppValues.some((appValue) => normalizedIdentityContains(appValue, candidate)),
    );
}

function findRunningShellApp(runningApps, normalizedCandidates) {
    for (const app of runningApps) {
        if (appMatchesIdentityCandidates(app, normalizedCandidates)) return app;
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

function findShellAppFromSearch(appSystem, lookupHints, normalizedCandidates, runningAppsById) {
    if (typeof Shell.AppSystem.search !== "function") return null;

    for (const lookupHint of lookupHints) {
        let resultGroups;
        try {
            resultGroups = Shell.AppSystem.search(lookupHint);
        } catch (error) {
            logger.debugOnce("app-search", "Shell app search failed during MPRIS lookup", error);
            continue;
        }

        for (const appId of flattenSearchResultGroups(resultGroups)) {
            const normalizedAppId = String(appId);
            const app = runningAppsById.get(normalizedAppId) ?? appSystem.lookup_app(normalizedAppId);
            if (appMatchesIdentityCandidates(app, normalizedCandidates)) return app;
        }
    }
    return null;
}

function findShellAppByHeuristicLookup(appSystem, lookupHints) {
    const lookupMethods = ["lookup_heuristic_basename", "lookup_desktop_wmclass", "lookup_startup_wmclass"];
    for (const lookupHint of lookupHints) {
        for (const methodName of lookupMethods) {
            const lookup = appSystem[methodName];
            if (typeof lookup !== "function") continue;
            try {
                const app = lookup.call(appSystem, lookupHint);
                if (app) return app;
            } catch (error) {
                logger.debugOnce(`app-${methodName}`, `Shell ${methodName} lookup failed`, error);
            }
        }
    }
    return null;
}

function findShellApp(identity, desktopEntry, busName = "") {
    const appCacheKey = createAppCacheKey(identity, desktopEntry, busName);
    const cachedApp = readCachedResolvedApp(shellAppCache, appCacheKey);
    if (cachedApp) return cachedApp;

    try {
        const appSystem = Shell.AppSystem.get_default();
        const appIdCandidates = buildDesktopAppIdCandidates(identity, desktopEntry, busName);
        for (const appIdCandidate of appIdCandidates) {
            const app = appSystem.lookup_app(appIdCandidate);
            if (app) return storeBoundedCacheValue(shellAppCache, appCacheKey, app);
        }

        const normalizedCandidates = buildNormalizedAppIdentityCandidates(identity, desktopEntry, busName);
        const runningApps = appSystem.get_running();
        const runningApp = findRunningShellApp(runningApps, normalizedCandidates);
        if (runningApp) return storeBoundedCacheValue(shellAppCache, appCacheKey, runningApp);

        const lookupHints = buildAppLookupHints(identity, desktopEntry, busName);
        const heuristicApp = findShellAppByHeuristicLookup(appSystem, lookupHints);
        if (heuristicApp) return storeBoundedCacheValue(shellAppCache, appCacheKey, heuristicApp);

        const runningAppsById = new Map(
            runningApps
                .map((app) => [readAppStringSafely(() => app.get_id()), app])
                .filter(([appId]) => Boolean(appId)),
        );
        const searchedApp = findShellAppFromSearch(appSystem, lookupHints, normalizedCandidates, runningAppsById);
        if (searchedApp) return storeBoundedCacheValue(shellAppCache, appCacheKey, searchedApp);
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
    logger.debugOnce(
        `no-shell-app:${appCacheKey}`,
        "No Shell app matched the MPRIS identity",
        desktopEntry || identity || busName || "unknown",
    );
    return null;
}

function findAppInfo(identity, desktopEntry, busName = "") {
    const appCacheKey = createAppCacheKey(identity, desktopEntry, busName);
    const cachedApp = readCachedResolvedApp(appInfoCache, appCacheKey);
    if (cachedApp) return cachedApp;

    try {
        const appIdCandidates = buildDesktopAppIdCandidates(identity, desktopEntry, busName);
        for (const appIdCandidate of appIdCandidates) {
            const app = Gio.DesktopAppInfo.new(appIdCandidate);
            if (app) return storeBoundedCacheValue(appInfoCache, appCacheKey, app);
        }

        const candidateAppIdSet = new Set(appIdCandidates);
        const normalizedCandidates = buildNormalizedAppIdentityCandidates(identity, desktopEntry, busName);
        for (const app of Gio.AppInfo.get_all()) {
            const appId = readAppStringSafely(() => app.get_id());
            if (candidateAppIdSet.has(appId)) return storeBoundedCacheValue(appInfoCache, appCacheKey, app);
            if (appMatchesIdentityCandidates(app, normalizedCandidates))
                return storeBoundedCacheValue(appInfoCache, appCacheKey, app);
        }
    } catch (error) {
        logger.warnOnce("desktop-app-enumeration", "Failed to inspect desktop apps", error);
    }

    return null;
}

export function resolveShellMediaApp(identity, desktopEntry, busName = "") {
    return findShellApp(identity, desktopEntry, busName);
}

// Lifecycle decisions intentionally accept only the exact MPRIS DesktopEntry.
// Identity, bus-name, WM-class, running-app and search heuristics are suitable
// for presentation, but are not strong enough evidence to destroy a player.
export function resolveLifecycleShellApp(desktopEntry) {
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

export function isShellAppStopped(app) {
    if (!app || typeof app.get_state !== "function") return false;

    try {
        return app.get_state() === Shell.AppState.STOPPED;
    } catch (error) {
        logger.debugOnce("lifecycle-app-state", "Shell app state became unavailable during cleanup", error);
        return false;
    }
}

export function resolveMediaApp(identity, desktopEntry, busName = "") {
    return resolveShellMediaApp(identity, desktopEntry, busName) ?? findAppInfo(identity, desktopEntry, busName);
}

function getFallbackMediaAppIcon() {
    fallbackMediaAppIcon ??= Gio.ThemedIcon.new_from_names([IconNames.MEDIA, IconNames.MISSING]);
    return fallbackMediaAppIcon;
}

function readMediaAppIcon(app) {
    if (!app) return null;

    const directIcon = app.get_icon?.();
    if (directIcon) return directIcon;
    return getAppInfoSafely(app)?.get_icon?.() ?? null;
}

export function getMediaAppIcon(app) {
    try {
        return readMediaAppIcon(app) ?? getFallbackMediaAppIcon();
    } catch (error) {
        logger.debugOnce("media-app-icon", "The app icon could not be read; using the fallback", error);
        return getFallbackMediaAppIcon();
    }
}

export function hasResolvedMediaAppIcon(app) {
    try {
        return Boolean(readMediaAppIcon(app));
    } catch (error) {
        logger.debugOnce("media-app-icon-resolution", "The app icon is not available yet", error);
        return false;
    }
}

export function getMediaAppName(app, fallback) {
    try {
        const appInfo = getAppInfoSafely(app);
        return (
            app?.get_display_name?.() ||
            app?.get_name?.() ||
            appInfo?.get_display_name?.() ||
            appInfo?.get_name?.() ||
            fallback
        );
    } catch (error) {
        logger.debugOnce("media-app-name", "The app name could not be read; using the MPRIS identity", error);
        return fallback;
    }
}

export function isMediaAppBlocked(identity, desktopEntry, blockedAppIds, busName = "") {
    const blockedAppIdSet = blockedAppIds instanceof Set ? blockedAppIds : new Set(blockedAppIds ?? []);
    if (blockedAppIdSet.size === 0) return false;

    const appIdCandidates = buildDesktopAppIdCandidates(identity, desktopEntry, busName);
    if (appIdCandidates.some((appId) => blockedAppIdSet.has(appId))) return true;

    const app = resolveMediaApp(identity, desktopEntry, busName);
    const appId = readAppStringSafely(() => app?.get_id?.());
    return Boolean(appId && blockedAppIdSet.has(appId));
}

export function clearMediaAppResolverCaches() {
    shellAppCache.clear();
    appInfoCache.clear();
    fallbackMediaAppIcon = null;
}
