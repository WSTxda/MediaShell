/**
 * @file windowIdentity.js
 * @module shell.media.application.windowIdentity
 *
 * Pure Chromium-PWA window identity policy for the Shell application domain.
 *
 * Runtime window enumeration stays in PlayerWindowResolver. These helpers only
 * compare stable PWA app IDs already exposed by desktop/window metadata; titles,
 * browser brands, media-service names, and process IDs are never identity proof.
 */

import { extractChromiumPwaAppIds } from "../../../shared/identity/browser.js";

export const PlayerWindowEvidence = Object.freeze({
  SHELL_APP: "pwa-shell-app",
  TRACKED_APP: "pwa-tracked-app",
  WINDOW_CLASS: "pwa-window-class",
  GTK_APPLICATION_ID: "pwa-gtk-application-id",
});

function extractDescriptorPwaAppIds(descriptor = {}) {
  return new Set(
    extractChromiumPwaAppIds(
      descriptor.trackedDesktopId,
      descriptor.trackedStartupWmClass,
      descriptor.wmClass,
      descriptor.wmClassInstance,
      descriptor.gtkApplicationId,
    ),
  );
}

/**
 * Returns exact structural evidence that one window belongs to a target PWA.
 *
 * Conflicting PWA IDs fail closed even when one field happens to contain the
 * requested ID. This keeps window activation from turning partial browser
 * metadata into a cross-PWA focus decision.
 */
export function resolvePwaWindowEvidence(targetPwaAppId, descriptor = {}) {
  const target = String(targetPwaAppId ?? "").toLowerCase();
  if (!target) return null;

  const descriptorAppIds = extractDescriptorPwaAppIds(descriptor);
  if (descriptorAppIds.size !== 1 || !descriptorAppIds.has(target)) return null;

  if (
    extractChromiumPwaAppIds(
      descriptor.trackedDesktopId,
      descriptor.trackedStartupWmClass,
    ).includes(target)
  )
    return PlayerWindowEvidence.TRACKED_APP;

  if (
    extractChromiumPwaAppIds(
      descriptor.wmClass,
      descriptor.wmClassInstance,
    ).includes(target)
  )
    return PlayerWindowEvidence.WINDOW_CLASS;

  if (extractChromiumPwaAppIds(descriptor.gtkApplicationId).includes(target))
    return PlayerWindowEvidence.GTK_APPLICATION_ID;

  return null;
}

/** Chooses the most recently used window only after identity is already exact. */
export function chooseRecentPwaWindowCandidate(candidates = []) {
  return (
    [...candidates].sort(
      (left, right) =>
        Number(right.userTime ?? 0) - Number(left.userTime ?? 0) ||
        Number(right.stableSequence ?? 0) - Number(left.stableSequence ?? 0),
    )[0] ?? null
  );
}
