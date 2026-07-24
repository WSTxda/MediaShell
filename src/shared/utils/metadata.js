/**
 * @file metadata.js
 * @module shared.utils.metadata
 *
 * Normalizes MPRIS metadata into text that MediaShell widgets can display safely.
 *
 * PopupTrackInformation and TopBarTrackInformation use these helpers to share
 * field extraction, custom text handling, and missing-metadata rules without
 * sharing actor code. The functions stay pure so metadata policy can be tested
 * outside GNOME Shell.
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

function sanitizeSingleLineText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatListValue(value) {
  if (Array.isArray(value))
    return value.map(sanitizeSingleLineText).filter(Boolean).join(", ");
  return sanitizeSingleLineText(value);
}

function formatYear(value) {
  const text = formatListValue(value);
  return text.match(/^\d{4}/)?.[0] ?? text;
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
export function readTrackInformationField(metadata = {}, field) {
  const metadataKey = METADATA_FIELD_KEYS[field];
  if (!metadataKey) return "";

  const value = metadata[metadataKey];
  if (field === TrackInformationFields.CONTENT_CREATED)
    return formatYear(value);
  return formatListValue(value);
}

/**
 * Reads all track-information fields MediaShell can display from MPRIS metadata.
 *
 * @param {Record<string, unknown>} metadata - Raw MPRIS metadata map.
 * @returns {Record<string, string>} Field ID to display-safe text.
 */
export function readTrackInformation(metadata = {}) {
  return Object.fromEntries(
    Object.values(TrackInformationFields).map((field) => [
      field,
      readTrackInformationField(metadata, field),
    ]),
  );
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

  for (const contentItem of contentItems) {
    if (Object.values(TrackInformationFields).includes(contentItem)) {
      const text = readTrackInformationField(metadata, contentItem);
      if (text) items.push({ field: contentItem, text, isCustomText: false });
      continue;
    }

    const text = sanitizeSingleLineText(contentItem);
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
