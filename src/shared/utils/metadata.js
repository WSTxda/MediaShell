/**
 * @file metadata.js
 * @module shared.utils.metadata
 *
 * Normalizes untrusted MPRIS metadata into stable protocol and display values.
 *
 * PlayerProxy uses the canonical metadata object and revision helpers before
 * publishing state. PopupTrackInformation and TopBarTrackInformation use the
 * display helpers so both surfaces share field extraction, list formatting,
 * custom text handling, and missing-metadata rules without sharing actor code.
 * Every helper stays pure so the policy can be tested outside GNOME Shell.
 */

import { MprisMetadataKeys } from "../constants/dbus.js";
import { TrackInformationFields } from "../enums/trackInformation.js";

const METADATA_FIELD_KEYS = Object.freeze({
  [TrackInformationFields.TITLE]: MprisMetadataKeys.TITLE,
  [TrackInformationFields.ARTIST]: MprisMetadataKeys.ARTIST,
  [TrackInformationFields.ALBUM]: MprisMetadataKeys.ALBUM,
  [TrackInformationFields.ALBUM_ARTIST]: MprisMetadataKeys.ALBUM_ARTIST,
  [TrackInformationFields.GENRE]: MprisMetadataKeys.GENRE,
  [TrackInformationFields.CONTENT_CREATED]: MprisMetadataKeys.CONTENT_CREATED,
  [TrackInformationFields.COMPOSER]: MprisMetadataKeys.COMPOSER,
  [TrackInformationFields.DISC_NUMBER]: MprisMetadataKeys.DISC_NUMBER,
  [TrackInformationFields.TRACK_NUMBER]: MprisMetadataKeys.TRACK_NUMBER,
});

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
 * Converts one display value to safe single-line text.
 *
 * Objects, functions, and symbols are rejected instead of leaking JavaScript
 * representations such as `[object Object]` into GNOME Shell labels.
 *
 * @param {unknown} value - Raw scalar display value.
 * @returns {string} Sanitized single-line text, or an empty string.
 */
export function normalizeMetadataDisplayText(value) {
  const unpacked = unpackMetadataValue(value);
  if (
    typeof unpacked !== "string" &&
    typeof unpacked !== "number" &&
    typeof unpacked !== "bigint"
  )
    return "";

  return String(unpacked)
    .replace(/<[^>]*>/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatListValue(value) {
  const unpacked = unpackMetadataValue(value);
  if (Array.isArray(unpacked))
    return unpacked
      .map((item) => normalizeMetadataDisplayText(item))
      .filter(Boolean)
      .join(", ");
  return normalizeMetadataDisplayText(unpacked);
}

function formatYear(value) {
  const text = formatListValue(value);
  return text.match(/^\d{4}/)?.[0] ?? text;
}

/**
 * Normalizes one raw MPRIS metadata payload into a stable plain object.
 *
 * Unknown keys are retained after one safe variant-unpack step. Known keys are
 * normalized to the shapes MediaShell consumes so malformed third-party values
 * cannot destabilize revision checks, position identity, or visible labels.
 *
 * @param {unknown} metadataValue - Raw metadata map or GLib.Variant-like value.
 * @returns {Record<string, unknown>} New normalized metadata object.
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

/**
 * Builds a stable revision for every metadata field consumed by MediaShell.
 *
 * @param {Record<string, unknown>} metadata - Canonical normalized metadata.
 * @returns {string} Stable revision string.
 */
export function createMprisMetadataRevision(metadata = {}) {
  return JSON.stringify(
    REVISION_METADATA_KEYS.map((key) => metadata?.[key] ?? null),
  );
}

/**
 * Formats the MPRIS artist field into a single display string.
 *
 * MPRIS commonly exposes `xesam:artist` as an array of strings, but sparse
 * endpoints may send a string, an empty array, or no value. This helper is kept
 * as a small public utility for tests and call sites that need explicit artist
 * fallback behavior.
 *
 * @param {unknown} artistValue - Raw `xesam:artist` value from MPRIS metadata.
 * @param {string} fallback - Text used when no non-empty artist name is available.
 * @returns {string} Comma-separated artist names or the fallback.
 */
export function formatArtistNames(artistValue, fallback = "") {
  return formatListValue(artistValue) || fallback;
}

/**
 * Reads a single configured track-information field from raw MPRIS metadata.
 *
 * Missing or empty fields return an empty string so configurable displays can
 * hide unavailable MPRIS metadata instead of showing fallback placeholders.
 *
 * @param {Record<string, unknown>} metadata - Raw MPRIS metadata map.
 * @param {string} field - One of TrackInformationFields.
 * @returns {string} Display-safe single-line text, or an empty string.
 */
function readTrackInformationField(metadata = {}, field) {
  const metadataKey = METADATA_FIELD_KEYS[field];
  if (!metadataKey) return "";

  const value = metadata[metadataKey];
  if (field === TrackInformationFields.CONTENT_CREATED)
    return formatYear(value);
  return formatListValue(value);
}

/**
 * Builds ordered display items from metadata fields and custom text fragments.
 *
 * Unknown field IDs are kept as literal custom text so hand-edited settings do
 * not erase user intent. Empty metadata fields and empty custom text are hidden.
 *
 * @param {Record<string, unknown>} metadata - Raw MPRIS metadata map.
 * @param {string[]} contentItems - Ordered field IDs or custom text fragments.
 * @returns {{field: string|null, text: string, isCustomText: boolean}[]} Display items.
 */
export function buildTrackInformationItems(metadata = {}, contentItems = []) {
  const items = [];

  for (const contentItem of Array.isArray(contentItems) ? contentItems : []) {
    if (Object.values(TrackInformationFields).includes(contentItem)) {
      const text = readTrackInformationField(metadata, contentItem);
      if (text) items.push({ field: contentItem, text, isCustomText: false });
      continue;
    }

    const text = normalizeMetadataDisplayText(contentItem);
    if (text) items.push({ field: null, text, isCustomText: true });
  }

  return items;
}

/**
 * Builds the compact top bar track-information string from ordered content items.
 *
 * @param {Record<string, unknown>} metadata - Raw MPRIS metadata map.
 * @param {string[]} contentItems - Ordered field IDs or custom text fragments.
 * @returns {string} Single-line text ready for the top bar label.
 */
export function buildTrackInformationText(metadata = {}, contentItems = []) {
  return buildTrackInformationItems(metadata, contentItems)
    .map((item) => item.text)
    .join(" ");
}
