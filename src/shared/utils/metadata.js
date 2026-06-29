/**
 * @file metadata.js
 * @module shared.utils.metadata
 *
 * Normalizes MPRIS metadata into text that MediaShell widgets can display safely.
 *
 * PopupTrackInformation and TopBarTrackInformation use these helpers to share
 * title, artist, album, disc, and track fallbacks without sharing actor code. The
 * functions stay pure so metadata rules can be tested outside GNOME Shell.
 */

import { TrackInformationFields } from "../enums/trackInformation.js";

/**
 * Formats the MPRIS artist field into a single display string.
 *
 * MPRIS commonly exposes `xesam:artist` as an array of strings, but sparse
 * endpoints may send a string, an empty array, or no value. This helper keeps the
 * fallback policy identical for popup and top bar track information without requiring
 * either widget to know the raw metadata shape.
 *
 * @param {unknown} artistValue - Raw `xesam:artist` value from MPRIS metadata.
 * @param {string} fallback - Text used when no non-empty artist name is available.
 * @returns {string} Comma-separated artist names or the fallback.
 */
export function formatArtistNames(artistValue, fallback = "") {
  if (Array.isArray(artistValue))
    return artistValue.filter(Boolean).join(", ") || fallback;
  if (typeof artistValue === "string" && artistValue.trim()) return artistValue;
  return fallback;
}

/**
 * Reads the track fields MediaShell displays from raw MPRIS metadata.
 *
 * The returned object is intentionally UI-neutral: PopupTrackInformation can bind
 * individual labels while TopBarTrackInformation can assemble the same fields
 * into a compact ordered string. Field fallback text is supplied by callers so
 * gettext stays close to the UI surface that displays the value.
 *
 * @param {Record<string, unknown>} metadata - Raw MPRIS metadata map.
 * @param {{unknownArtist?: string, unknownAlbum?: string}} fallbacks - Display fallbacks.
 * @returns {{title: unknown, artist: string, album: unknown, discNumber: unknown, trackNumber: unknown}}
 */
export function readTrackInformation(metadata = {}, fallbacks = {}) {
  const unknownArtist = fallbacks.unknownArtist ?? "";
  const unknownAlbum = fallbacks.unknownAlbum ?? "";

  return {
    title: metadata["xesam:title"] ?? "",
    artist: formatArtistNames(metadata["xesam:artist"], unknownArtist),
    album: metadata["xesam:album"] || unknownAlbum,
    discNumber: metadata["xesam:discNumber"],
    trackNumber: metadata["xesam:trackNumber"],
  };
}

/**
 * Builds the top bar track information string from ordered field IDs.
 *
 * Unknown field IDs are kept as literal custom text so older or hand-edited
 * settings do not erase user intent. Newline characters are flattened because
 * top bar text is rendered inside a single ScrollingLabel actor.
 *
 * @param {Record<string, unknown>} metadata - Raw MPRIS metadata map.
 * @param {string[]} fields - Ordered field IDs or custom text fragments.
 * @param {{unknownArtist?: string, unknownAlbum?: string}} fallbacks - Display fallbacks.
 * @returns {string} Single-line text ready for the top bar label.
 */
export function buildTrackInformationText(
  metadata = {},
  fields = [],
  fallbacks = {},
) {
  const trackInformation = readTrackInformation(metadata, fallbacks);
  const values = [];

  for (const field of fields) {
    const fieldValue = TrackInformationFields[field];
    if (fieldValue === TrackInformationFields.TITLE)
      values.push(trackInformation.title);
    else if (fieldValue === TrackInformationFields.ARTIST)
      values.push(trackInformation.artist);
    else if (fieldValue === TrackInformationFields.ALBUM)
      values.push(trackInformation.album);
    else if (fieldValue === TrackInformationFields.DISC_NUMBER)
      values.push(trackInformation.discNumber);
    else if (fieldValue === TrackInformationFields.TRACK_NUMBER)
      values.push(trackInformation.trackNumber);
    else values.push(field);
  }

  return values
    .filter((value) => value != null)
    .join(" ")
    .replace(/[\r\n]+/g, " ");
}
