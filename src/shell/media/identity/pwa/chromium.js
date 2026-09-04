/**
 * @file chromium.js
 * @module shell.media.identity.pwa.chromium
 *
 * Bridges Chromium PWA identity hints to installed GNOME desktop applications.
 *
 * Pure parsing/scoring remains in shared/identity/browser.js because Preferences
 * consumes the same contract. This module performs only Shell/Gio enumeration
 * and deterministic identity matching for the Shell process.
 */

import Gio from "gi://Gio";

import {
  resolveBrowserIdentityCandidate,
  resolveChromiumPwaAppId,
} from "../../../../shared/identity/browser.js";
import { readAppStringSafely, readDesktopAppDescriptor } from "../appInfo.js";
import { stripDesktopFileSuffix } from "../appIdentity.js";

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

function resolveBrowserIdentityApp(mediaIdentity, desktopApps) {
  const descriptorEntries = desktopApps
    .map((desktopApp) => ({
      desktopApp,
      descriptor: readDesktopAppDescriptor(desktopApp),
    }))
    .filter((entry) => entry.descriptor.desktopId);
  const match = resolveBrowserIdentityCandidate(
    mediaIdentity,
    descriptorEntries.map((entry) => entry.descriptor),
  );
  if (!match) return null;

  return (
    descriptorEntries.find(
      (candidate) => candidate.descriptor === match.descriptor,
    )?.desktopApp ?? null
  );
}

/** Resolves a Chromium PWA to Shell.App/Gio.AppInfo without fuzzy matching. */
export function resolveChromiumShellApp(
  appSystem,
  identity,
  desktopEntry,
  busName,
) {
  const mediaIdentity = createMediaIdentityDescriptor(
    identity,
    desktopEntry,
    busName,
  );
  const pwaAppId = resolveChromiumPwaAppId(mediaIdentity);
  if (!pwaAppId) return null;

  if (resolveChromiumPwaAppId({ desktopEntry }) === pwaAppId) {
    const exactDesktopApp = findShellAppByExactDesktopEntry(
      appSystem,
      desktopEntry,
    );
    if (exactDesktopApp) return exactDesktopApp;
  }

  const runningApps = appSystem.get_running();
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

  const match = resolveBrowserIdentityApp(mediaIdentity, [
    ...desktopAppsById.values(),
  ]);
  const appId = readAppStringSafely(() => match?.get_id?.());
  if (!appId) return null;

  return appSystem.lookup_app(appId) ?? desktopAppsById.get(appId) ?? null;
}

/** Resolves a Chromium PWA to Gio.AppInfo when Shell.App lookup misses. */
export function resolveChromiumAppInfo(identity, desktopEntry, busName) {
  const mediaIdentity = createMediaIdentityDescriptor(
    identity,
    desktopEntry,
    busName,
  );
  const pwaAppId = resolveChromiumPwaAppId(mediaIdentity);
  if (!pwaAppId) return null;

  if (resolveChromiumPwaAppId({ desktopEntry }) === pwaAppId) {
    const exactDesktopApp = findAppInfoByExactDesktopEntry(desktopEntry);
    if (exactDesktopApp) return exactDesktopApp;
  }

  return resolveBrowserIdentityApp(mediaIdentity, Gio.AppInfo.get_all());
}
