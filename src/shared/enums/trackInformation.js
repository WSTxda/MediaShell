/**
 * @file trackInformation.js
 * @module shared.enums.trackInformation
 *
 * Enum values for configurable track information metadata fields.
 *
 * Preferences store these IDs in user-selected order, while popup and top bar
 * widgets use the same IDs to read normalized MPRIS metadata. Keeping the enum
 * shared avoids duplicating metadata policy in separate UI surfaces.
 */

export const TrackInformationFields = Object.freeze({
  TITLE: "TITLE",
  ARTIST: "ARTIST",
  ALBUM: "ALBUM",
  ALBUM_ARTIST: "ALBUM_ARTIST",
  GENRE: "GENRE",
  COMPOSER: "COMPOSER",
  CONTENT_CREATED: "CONTENT_CREATED",
  DISC_NUMBER: "DISC_NUMBER",
  TRACK_NUMBER: "TRACK_NUMBER",
});
