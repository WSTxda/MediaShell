/**
 * @file cachePolicy.js
 * @module shell.media.artwork.cachePolicy
 *
 * Contains the deterministic, I/O-free persistent artwork cache eviction policy.
 */

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNonNegativeNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;
}

function normalizeTimestampMicroseconds(seconds, microseconds) {
  return (
    normalizeNonNegativeNumber(seconds) * 1_000_000 +
    Math.min(999_999, Math.trunc(normalizeNonNegativeNumber(microseconds)))
  );
}

/** Selects least-recently-used cache entries until the byte limit is satisfied. */
export function selectArtworkCacheEvictions(entries, maximumBytes) {
  const byteLimit = Math.max(0, Math.trunc(Number(maximumBytes) || 0));
  const normalizedEntries = (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const accessedMicroseconds = normalizeTimestampMicroseconds(
        entry?.accessedSeconds,
        entry?.accessedMicroseconds,
      );
      const modifiedMicroseconds = normalizeTimestampMicroseconds(
        entry?.modifiedSeconds,
        entry?.modifiedMicroseconds,
      );

      return {
        name: normalizeText(entry?.name),
        sizeBytes: Math.max(0, Math.trunc(Number(entry?.sizeBytes) || 0)),
        lastUsedMicroseconds: Math.max(
          accessedMicroseconds,
          modifiedMicroseconds,
        ),
      };
    })
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
