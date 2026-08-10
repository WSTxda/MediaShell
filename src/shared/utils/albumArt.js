/**
 * @file albumArt.js
 * @module shared.utils.albumArt
 *
 * Pure album-art request identity and persistent-cache capacity policy.
 *
 * Album-art renderers use immutable request snapshots to reject stale async results.
 * AlbumArtLoader uses the eviction helper after background cache writes. Keeping
 * both policies free of Gio and Shell objects makes race and capacity behavior
 * deterministic in Node tests.
 */

import { MprisMetadataKeys } from "../constants/mpris.js";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNonNegativeNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;
}

function normalizePositiveInteger(value, fallback = 1) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.round(numericValue))
    : fallback;
}

/**
 * Converts a panel-relative artwork preference to an actor size.
 *
 * @param {number} availableHeight - The themed content height available to the actor.
 * @param {number} percentage - Requested percentage of the available height.
 * @returns {number} A positive integer size in the actor's coordinate space.
 */
export function calculateAlbumArtDisplaySize(availableHeight, percentage) {
  const safeHeight = normalizePositiveInteger(availableHeight);
  const safePercentage = Math.min(
    100,
    Math.max(0, Number.isFinite(percentage) ? percentage : 0),
  );
  return Math.max(1, Math.round((safeHeight * safePercentage) / 100));
}

/**
 * Builds one immutable snapshot for an album-art render request.
 *
 * @param {object} input - Current app, metadata, geometry, and cache state.
 * @returns {{key: string, busName: string, albumArtUri: string, trackUri: string, width: number, radius: number, cacheEnabled: boolean}}
 *   Immutable request descriptor.
 */
export function createAlbumArtRequest({
  busName,
  metadata,
  width,
  radius,
  cacheEnabled,
}) {
  const safeBusName = normalizeText(busName);
  const safeMetadata =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata
      : {};
  const safeWidth = normalizePositiveInteger(width);
  const safeRadius = Math.min(
    Math.max(0, Math.round(Number(radius) || 0)),
    Math.round(safeWidth / 2),
  );
  const albumArtUri = normalizeText(safeMetadata[MprisMetadataKeys.ART_URL]);
  const trackUri = normalizeText(safeMetadata[MprisMetadataKeys.URL]);
  const isCacheEnabled = Boolean(cacheEnabled);
  const key = [
    safeBusName,
    albumArtUri,
    trackUri,
    safeWidth,
    safeRadius,
    isCacheEnabled,
  ].join("\u0000");

  return Object.freeze({
    key,
    busName: safeBusName,
    albumArtUri,
    trackUri,
    width: safeWidth,
    radius: safeRadius,
    cacheEnabled: isCacheEnabled,
  });
}

/**
 * Selects least-recently-used cache entries until the byte limit is satisfied.
 *
 * @param {{name: string, sizeBytes: number, modifiedSeconds?: number, modifiedMicroseconds?: number}[]} entries
 *   Cache files with persisted last-use timestamps.
 * @param {number} maximumBytes - Maximum total cache size in bytes.
 * @returns {string[]} File names to evict, least recently used first.
 */
export function selectAlbumArtCacheEvictions(entries, maximumBytes) {
  const byteLimit = Math.max(0, Math.trunc(Number(maximumBytes) || 0));
  const normalizedEntries = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      name: normalizeText(entry?.name),
      sizeBytes: Math.max(0, Math.trunc(Number(entry?.sizeBytes) || 0)),
      lastUsedMicroseconds:
        normalizeNonNegativeNumber(entry?.modifiedSeconds) * 1_000_000 +
        Math.min(
          999_999,
          Math.trunc(normalizeNonNegativeNumber(entry?.modifiedMicroseconds)),
        ),
    }))
    .filter((entry) => entry.name)
    .sort(
      (left, right) =>
        left.lastUsedMicroseconds - right.lastUsedMicroseconds ||
        left.name.localeCompare(right.name),
    );

  let remainingBytes = normalizedEntries.reduce(
    (total, entry) => total + entry.sizeBytes,
    0,
  );
  const evictions = [];

  for (const entry of normalizedEntries) {
    if (remainingBytes <= byteLimit) break;
    evictions.push(entry.name);
    remainingBytes -= entry.sizeBytes;
  }

  return evictions;
}
