/**
 * @file presentation.js
 * @module shell.media.track.presentation
 *
 * Formats the canonical MPRIS track snapshot for MediaShell presentation.
 *
 * Protocol parsing stays in shell/mpris/metadata.js. This layer only knows the
 * stable Track shape exposed by MprisPlayer, so Popup and Top Bar never need to
 * read raw mpris:/xesam: dictionary keys.
 */

import { TrackInformationFields } from "../../../shared/ui/trackInformation.js";

const TRACK_FIELD_PROPERTIES = Object.freeze({
  [TrackInformationFields.TITLE]: "title",
  [TrackInformationFields.ARTIST]: "artists",
  [TrackInformationFields.ALBUM]: "album",
  [TrackInformationFields.ALBUM_ARTIST]: "albumArtists",
  [TrackInformationFields.GENRE]: "genres",
  [TrackInformationFields.CONTENT_CREATED]: "contentCreated",
  [TrackInformationFields.COMPOSER]: "composer",
  [TrackInformationFields.DISC_NUMBER]: "discNumber",
  [TrackInformationFields.TRACK_NUMBER]: "trackNumber",
});

/**
 * Converts one display value to safe single-line text.
 *
 * Objects, functions, and symbols are rejected instead of leaking JavaScript
 * representations such as `[object Object]` into Shell labels.
 */
export function normalizeMetadataDisplayText(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  )
    return "";

  return String(value)
    .replace(/<[^>]*>/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatListValue(value) {
  if (Array.isArray(value))
    return value
      .map((item) => normalizeMetadataDisplayText(item))
      .filter(Boolean)
      .join(", ");
  return normalizeMetadataDisplayText(value);
}

function formatYear(value) {
  const text = formatListValue(value);
  return text.match(/^\d{4}/)?.[0] ?? text;
}

/** Formats an artist list into one label-ready value. */
export function formatArtistNames(artistValue, fallback = "") {
  return formatListValue(artistValue) || fallback;
}

function readTrackInformationField(track = {}, field) {
  const property = TRACK_FIELD_PROPERTIES[field];
  if (!property) return "";

  const value = track[property];
  if (field === TrackInformationFields.CONTENT_CREATED)
    return formatYear(value);
  return formatListValue(value);
}

/**
 * Builds ordered display items from one canonical Track and custom fragments.
 *
 * Unknown IDs remain literal custom text so a hand-edited setting cannot erase
 * user content. Missing track fields simply do not create labels.
 */
export function buildTrackInformationItems(track = {}, contentItems = []) {
  const items = [];

  for (const contentItem of Array.isArray(contentItems) ? contentItems : []) {
    if (Object.values(TrackInformationFields).includes(contentItem)) {
      const text = readTrackInformationField(track, contentItem);
      if (text) items.push({ field: contentItem, text, isCustomText: false });
      continue;
    }

    const text = normalizeMetadataDisplayText(contentItem);
    if (text) items.push({ field: null, text, isCustomText: true });
  }

  return items;
}

/** Builds the compact Top Bar string from ordered Track fields. */
export function buildTrackInformationText(track = {}, contentItems = []) {
  return buildTrackInformationItems(track, contentItems)
    .map((item) => item.text)
    .join(" ");
}
