/**
 * @file appIdentity.js
 * @module shell.media.identity.appIdentity
 *
 * Normalizes MPRIS bus names, identities, and desktop-entry hints into app IDs.
 *
 * DesktopAppResolver and installed-app search rely on these helpers to strip
 * unstable browser/session suffixes and desktop-file extensions. The functions
 * are pure so both Shell and preferences code can use the same matching rules.
 */

import { extractChromiumPwaAppIds } from "../../../shared/identity/browser.js";

import {
  MPRIS_BUS_NAME_PREFIX,
  normalizeMprisString,
} from "../../mpris/protocol.js";

const DESKTOP_FILE_SUFFIX = ".desktop";
const EPHEMERAL_BUS_SEGMENT_PATTERN =
  /^(?:instance|pid|process|tab|window)[-_]?[a-z0-9]*$/i;

/**
 * Normalizes one MPRIS identity or desktop-entry hint for display and lookup.
 *
 * @param {unknown} value - Raw MPRIS identity value.
 * @returns {string} Safe single-line string, or an empty string.
 */
export function normalizeAppIdentityHint(value) {
  return normalizeMprisString(value);
}

/**
 * Removes a `.desktop` suffix without changing the rest of the identifier.
 *
 * @param {unknown} value - Raw desktop entry or app ID.
 * @returns {string} Identifier without a desktop-file suffix.
 */
export function stripDesktopFileSuffix(value) {
  const normalizedValue = normalizeAppIdentityHint(value);
  return normalizedValue.toLowerCase().endsWith(DESKTOP_FILE_SUFFIX)
    ? normalizedValue.slice(0, -DESKTOP_FILE_SUFFIX.length)
    : normalizedValue;
}

/**
 * Converts an app identity into a search-friendly comparable form.
 *
 * Accents, punctuation, case, and desktop-file suffixes are normalized so MPRIS
 * identities, desktop entries, and installed-app names can be matched with the
 * same rules.
 *
 * @param {unknown} value - Raw app identity text.
 * @returns {string} Normalized lookup text.
 */
export function normalizeAppIdentity(value) {
  return stripDesktopFileSuffix(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Compares two already-normalized app identity values without substring matches
 * across token boundaries. Short identifiers stay exact to avoid matching
 * unrelated applications by a two-character fragment.
 */
export function normalizedIdentityContains(
  normalizedValue,
  normalizedCandidate,
) {
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

function addLookupHint(hints, value) {
  const rawValue = stripDesktopFileSuffix(value);
  if (!rawValue) return;

  hints.add(rawValue);
  hints.add(rawValue.toLowerCase());

  const normalizedValue = normalizeAppIdentity(rawValue);
  if (!normalizedValue) return;
  hints.add(normalizedValue);
  hints.add(normalizedValue.replaceAll(" ", "-"));
  hints.add(normalizedValue.replaceAll(" ", ""));
}

function addBrowserIdentityHints(hints, ...values) {
  for (const appId of extractChromiumPwaAppIds(values)) {
    addLookupHint(hints, appId);
    addLookupHint(hints, `crx_${appId}`);
  }
}

function addBusNameHints(hints, busName) {
  const normalizedBusName = normalizeAppIdentityHint(busName);
  if (!normalizedBusName.startsWith(MPRIS_BUS_NAME_PREFIX)) return;

  const busSuffix = normalizedBusName.slice(MPRIS_BUS_NAME_PREFIX.length);
  addLookupHint(hints, busSuffix);

  const segments = busSuffix.split(".").filter(Boolean);
  if (segments.length === 0) return;

  addLookupHint(hints, segments[0]);
  const ephemeralSegmentIndex = segments.findIndex(
    (segment, index) =>
      index > 0 && EPHEMERAL_BUS_SEGMENT_PATTERN.test(segment),
  );
  if (ephemeralSegmentIndex > 0)
    addLookupHint(hints, segments.slice(0, ephemeralSegmentIndex).join("."));
}

/**
 * Builds all lookup hints MediaShell can derive for one MPRIS player.
 *
 * The result combines desktop-entry, identity, and bus-name candidates. Browser
 * sessions often append tab/window/process suffixes to the MPRIS bus; those are
 * reduced to stable prefixes so the Shell app resolver can still find the owning
 * desktop app.
 *
 * @param {unknown} identity - MPRIS Identity value.
 * @param {unknown} desktopEntry - MPRIS DesktopEntry value.
 * @param {string} busName - Full MPRIS bus name.
 * @returns {string[]} Unique raw and normalized lookup hints.
 */
export function buildAppLookupHints(identity, desktopEntry, busName = "") {
  const hints = new Set();
  addLookupHint(hints, desktopEntry);
  addLookupHint(hints, identity);
  addBusNameHints(hints, busName);
  addBrowserIdentityHints(hints, desktopEntry, identity, busName);
  return [...hints];
}

/**
 * Builds desktop-app ID candidates from MPRIS player identity metadata.
 *
 * @param {unknown} identity - MPRIS Identity value.
 * @param {unknown} desktopEntry - MPRIS DesktopEntry value.
 * @param {string} busName - Full MPRIS bus name.
 * @returns {string[]} Candidate desktop IDs with and without `.desktop` suffixes.
 */
export function buildDesktopAppIdCandidates(
  identity,
  desktopEntry,
  busName = "",
) {
  const appIds = new Set();
  for (const hint of buildAppLookupHints(identity, desktopEntry, busName)) {
    const basename = stripDesktopFileSuffix(hint);
    if (!basename) continue;
    appIds.add(basename);
    appIds.add(`${basename}${DESKTOP_FILE_SUFFIX}`);
  }
  return [...appIds];
}

/**
 * Builds normalized identity candidates for fuzzy installed-app matching.
 *
 * @param {unknown} identity - MPRIS Identity value.
 * @param {unknown} desktopEntry - MPRIS DesktopEntry value.
 * @param {string} busName - Full MPRIS bus name.
 * @returns {string[]} Normalized comparable identity values.
 */
export function buildNormalizedAppIdentityCandidates(
  identity,
  desktopEntry,
  busName = "",
) {
  const identities = new Set();
  for (const hint of buildAppLookupHints(identity, desktopEntry, busName)) {
    const normalizedHint = normalizeAppIdentity(hint);
    if (normalizedHint) identities.add(normalizedHint);
  }
  return [...identities];
}
