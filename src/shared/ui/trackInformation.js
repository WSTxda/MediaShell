/**
 * @file trackInformation.js
 * @module shared.ui.trackInformation
 *
 * Enum values for configurable track information metadata fields.
 *
 * Preferences store these IDs in user-selected order, while popup and top bar
 * widgets use the same IDs to read normalized MPRIS metadata. Keeping the enum
 * shared avoids duplicating metadata policy in separate UI surfaces.
 */

export const TrackInformationFields = Object.freeze({
  TITLE: "title",
  ARTIST: "artist",
  ALBUM: "album",
  ALBUM_ARTIST: "album-artist",
  GENRE: "genre",
  COMPOSER: "composer",
  CONTENT_CREATED: "content-created",
  DISC_NUMBER: "disc-number",
  TRACK_NUMBER: "track-number",
});
