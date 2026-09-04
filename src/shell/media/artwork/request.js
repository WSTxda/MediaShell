/**
 * @file request.js
 * @module shell.media.artwork.request
 *
 * Creates immutable artwork request snapshots from canonical MPRIS track state.
 *
 * Request identity deliberately excludes presentation geometry and cache policy.
 * A resize, corner-radius change, or cache toggle can therefore reuse the same
 * decoded source instead of pretending the underlying track artwork changed.
 */

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePositiveInteger(value, fallback = 1) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.round(numericValue))
    : fallback;
}

/** Builds one immutable request for the current player/track artwork source. */
export function createArtworkRequest({ busName, track, width, radius }) {
  const safeBusName = normalizeText(busName);
  const safeTrack = track && typeof track === "object" ? track : {};
  const safeWidth = normalizePositiveInteger(width);
  const safeRadius = Math.min(
    Math.max(0, Math.round(Number(radius) || 0)),
    Math.round(safeWidth / 2),
  );
  const artUrl = normalizeText(safeTrack.artUrl);
  const trackUrl = normalizeText(safeTrack.url);
  const key = [safeBusName, artUrl, trackUrl].join("\u0000");

  return Object.freeze({
    key,
    busName: safeBusName,
    artUrl,
    trackUrl,
    width: safeWidth,
    radius: safeRadius,
  });
}
