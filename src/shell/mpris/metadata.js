/**
 * @file metadata.js
 * @module shell.mpris.metadata
 *
 * Normalizes untrusted MPRIS Metadata payloads into one canonical representation.
 *
 * This module is the protocol boundary for track identity and metadata shape. It
 * deliberately knows nothing about Popup, Top Bar, GtkBuilder, artwork loading,
 * or presentation settings. Consumers receive stable plain values even when a
 * third-party endpoint publishes malformed or transient D-Bus variants.
 */

import { MPRIS_NO_TRACK_PATH, MprisMetadataKeys } from "./protocol.js";

const DBUS_OBJECT_PATH_PATTERN = /^\/(?:[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*)?$/;

const TEXT_METADATA_KEYS = Object.freeze([
  MprisMetadataKeys.TRACK_ID,
  MprisMetadataKeys.ART_URL,
  MprisMetadataKeys.URL,
  MprisMetadataKeys.TITLE,
  MprisMetadataKeys.ALBUM,
  MprisMetadataKeys.CONTENT_CREATED,
  MprisMetadataKeys.COMPOSER,
]);

const LIST_METADATA_KEYS = Object.freeze([
  MprisMetadataKeys.ARTIST,
  MprisMetadataKeys.ALBUM_ARTIST,
  MprisMetadataKeys.GENRE,
]);

const INTEGER_METADATA_KEYS = Object.freeze([
  MprisMetadataKeys.DISC_NUMBER,
  MprisMetadataKeys.TRACK_NUMBER,
]);

const REVISION_METADATA_KEYS = Object.freeze([
  MprisMetadataKeys.TRACK_ID,
  MprisMetadataKeys.LENGTH,
  MprisMetadataKeys.ART_URL,
  MprisMetadataKeys.URL,
  MprisMetadataKeys.TITLE,
  MprisMetadataKeys.ARTIST,
  MprisMetadataKeys.ALBUM,
  MprisMetadataKeys.ALBUM_ARTIST,
  MprisMetadataKeys.GENRE,
  MprisMetadataKeys.CONTENT_CREATED,
  MprisMetadataKeys.COMPOSER,
  MprisMetadataKeys.DISC_NUMBER,
  MprisMetadataKeys.TRACK_NUMBER,
]);

function unpackMetadataValue(value) {
  return value?.recursiveUnpack?.() ?? value?.deepUnpack?.() ?? value;
}

function normalizeProtocolText(value) {
  const unpacked = unpackMetadataValue(value);
  return typeof unpacked === "string" ? unpacked.trim() : "";
}

function normalizeProtocolTextList(value) {
  const unpacked = unpackMetadataValue(value);
  const values = Array.isArray(unpacked) ? unpacked : [unpacked];
  return values.map((item) => normalizeProtocolText(item)).filter(Boolean);
}

function normalizeProtocolInteger(value) {
  const unpacked = unpackMetadataValue(value);
  if (
    unpacked === null ||
    unpacked === undefined ||
    unpacked === "" ||
    typeof unpacked === "boolean"
  )
    return null;
  const numericValue = Number(unpacked);
  return Number.isSafeInteger(numericValue) ? numericValue : null;
}

function normalizeProtocolLength(value) {
  const unpacked = unpackMetadataValue(value);
  if (
    unpacked === null ||
    unpacked === undefined ||
    unpacked === "" ||
    typeof unpacked === "boolean"
  )
    return null;
  const numericValue = Number(unpacked);
  return Number.isFinite(numericValue) && numericValue >= 0
    ? numericValue
    : null;
}

/**
 * Returns a concrete MPRIS track object path or null.
 *
 * The NoTrack sentinel represents absence of a track and cannot be used by
 * Player.SetPosition().
 */
export function normalizeMprisTrackId(value) {
  const trackId = typeof value === "string" ? value.trim() : "";
  return trackId &&
    trackId !== MPRIS_NO_TRACK_PATH &&
    DBUS_OBJECT_PATH_PATTERN.test(trackId)
    ? trackId
    : null;
}

/** Returns whether normalized metadata represents a usable current track. */
export function metadataContainsTrack(metadata) {
  if (!metadata || typeof metadata !== "object") return false;

  const trackId = metadata[MprisMetadataKeys.TRACK_ID];
  if (trackId === MPRIS_NO_TRACK_PATH) return false;
  return Boolean(
    metadata[MprisMetadataKeys.TITLE] || normalizeMprisTrackId(trackId),
  );
}

/**
 * Normalizes one raw MPRIS Metadata payload into a stable plain object.
 *
 * Unknown keys are retained after one safe variant-unpack step. Known fields
 * are constrained to the shapes consumed by MediaShell so malformed endpoints
 * cannot destabilize identity, revisions, position tracking, or presentation.
 */
export function normalizeMprisMetadata(metadataValue) {
  const unpackedMetadata = unpackMetadataValue(metadataValue);
  if (
    !unpackedMetadata ||
    typeof unpackedMetadata !== "object" ||
    Array.isArray(unpackedMetadata)
  )
    return {};

  const normalized = {};
  for (const [key, value] of Object.entries(unpackedMetadata))
    normalized[key] = unpackMetadataValue(value);

  for (const key of TEXT_METADATA_KEYS) {
    const value = normalizeProtocolText(normalized[key]);
    if (value) normalized[key] = value;
    else delete normalized[key];
  }

  for (const key of LIST_METADATA_KEYS) {
    const value = normalizeProtocolTextList(normalized[key]);
    if (value.length > 0) normalized[key] = value;
    else delete normalized[key];
  }

  for (const key of INTEGER_METADATA_KEYS) {
    const value = normalizeProtocolInteger(normalized[key]);
    if (value !== null) normalized[key] = value;
    else delete normalized[key];
  }

  const length = normalizeProtocolLength(normalized[MprisMetadataKeys.LENGTH]);
  if (length !== null) normalized[MprisMetadataKeys.LENGTH] = length;
  else delete normalized[MprisMetadataKeys.LENGTH];

  return normalized;
}

function normalizeIdentityValue(value) {
  if (Array.isArray(value))
    return value.map(normalizeIdentityValue).join("\u0000");
  return String(value ?? "").trim();
}

function cloneTextList(value) {
  return Object.freeze(Array.isArray(value) ? [...value] : []);
}

/**
 * Creates MediaShell's immutable semantic view of one normalized MPRIS track.
 *
 * The raw normalized metadata map remains available on MprisPlayer for protocol
 * consumers, while this snapshot gives later runtime/UI layers a stable API that
 * does not require knowledge of xesam/mpris dictionary keys.
 */
export function createMprisTrack(metadata = {}) {
  const safeMetadata =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata
      : {};

  return Object.freeze({
    id: normalizeMprisTrackId(safeMetadata[MprisMetadataKeys.TRACK_ID]),
    lengthMicroseconds:
      normalizeProtocolLength(safeMetadata[MprisMetadataKeys.LENGTH]) ?? null,
    artUrl: normalizeProtocolText(safeMetadata[MprisMetadataKeys.ART_URL]),
    url: normalizeProtocolText(safeMetadata[MprisMetadataKeys.URL]),
    title: normalizeProtocolText(safeMetadata[MprisMetadataKeys.TITLE]),
    artists: cloneTextList(safeMetadata[MprisMetadataKeys.ARTIST]),
    album: normalizeProtocolText(safeMetadata[MprisMetadataKeys.ALBUM]),
    albumArtists: cloneTextList(safeMetadata[MprisMetadataKeys.ALBUM_ARTIST]),
    genres: cloneTextList(safeMetadata[MprisMetadataKeys.GENRE]),
    contentCreated: normalizeProtocolText(
      safeMetadata[MprisMetadataKeys.CONTENT_CREATED],
    ),
    composer: normalizeProtocolText(safeMetadata[MprisMetadataKeys.COMPOSER]),
    discNumber:
      normalizeProtocolInteger(safeMetadata[MprisMetadataKeys.DISC_NUMBER]) ??
      null,
    trackNumber:
      normalizeProtocolInteger(safeMetadata[MprisMetadataKeys.TRACK_NUMBER]) ??
      null,
  });
}

/**
 * Builds the stable identity evidence used to compare MPRIS tracks.
 *
 * A concrete TrackId is authoritative when both snapshots provide one. Sparse
 * or temporarily incomplete endpoints can still be compared through URL, title,
 * and artists so later artwork/album enrichment does not look like a new track.
 */
export function createMprisTrackIdentity(metadata = {}) {
  const safeMetadata =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata
      : {};
  const trackId = normalizeMprisTrackId(
    safeMetadata[MprisMetadataKeys.TRACK_ID],
  );
  const fallbackParts = [
    safeMetadata[MprisMetadataKeys.URL],
    safeMetadata[MprisMetadataKeys.TITLE],
    safeMetadata[MprisMetadataKeys.ARTIST],
  ].map(normalizeIdentityValue);
  const fallback = fallbackParts.some(Boolean)
    ? fallbackParts.join("\u0001")
    : null;

  return Object.freeze({ trackId, fallback });
}

/** Returns whether an identity snapshot contains usable track evidence. */
export function hasMprisTrackIdentity(identity) {
  return Boolean(identity?.trackId || identity?.fallback);
}

/** Returns whether two identity snapshots represent the same current track. */
export function areMprisTrackIdentitiesEqual(first, second) {
  if (!first || !second) return false;
  if (first.trackId && second.trackId) return first.trackId === second.trackId;
  return Boolean(
    first.fallback && second.fallback && first.fallback === second.fallback,
  );
}

/** Returns the position-tracker key for one identity snapshot. */
export function createMprisTrackIdentityKey(identity) {
  if (!identity) return null;
  if (identity.trackId) return `track-id:${identity.trackId}`;
  return identity.fallback ? `metadata:${identity.fallback}` : null;
}

/** Builds the stable revision used to suppress equivalent Metadata updates. */
export function createMprisMetadataRevision(metadata = {}) {
  return JSON.stringify(
    REVISION_METADATA_KEYS.map((key) => metadata?.[key] ?? null),
  );
}
