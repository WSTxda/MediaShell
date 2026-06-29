/**
 * @file trackInformation.js
 * @module shared.enums.trackInformation
 *
 * Enum values for metadata fields used by top bar track information.
 *
 * Preferences store these IDs in the user-selected order, and runtime widgets
 * use the same values when assembling the compact top bar label. Keeping the
 * enum separate from top bar placement avoids mixing metadata policy with layout.
 */

export const TrackInformationFields = Object.freeze({
  ARTIST: "Artist",
  TITLE: "Title",
  ALBUM: "Album",
  DISC_NUMBER: "Disc Number",
  TRACK_NUMBER: "Track Number",
});
