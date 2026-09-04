/**
 * @file protocol.js
 * @module shell.mpris.protocol
 *
 * Defines MPRIS bus identity, interfaces, methods, signals, metadata keys, and
 * the canonical property lists hydrated by MediaShell.
 */

/** Prefix shared by every MPRIS media-app bus name. */
export const MPRIS_BUS_NAME_PREFIX = "org.mpris.MediaPlayer2.";

/** Root MPRIS interface implemented by the media app endpoint. */
export const MPRIS_ROOT_IFACE_NAME = "org.mpris.MediaPlayer2";

/** MPRIS Player interface that exposes transport state, metadata, and controls. */
export const MPRIS_PLAYER_IFACE_NAME = "org.mpris.MediaPlayer2.Player";

/** Object path used by the root and Player interfaces in the MPRIS specification. */
export const MPRIS_OBJECT_PATH = "/org/mpris/MediaPlayer2";

/** Sentinel track path reported by MPRIS when no concrete track is available. */
export const MPRIS_NO_TRACK_PATH = "/org/mpris/MediaPlayer2/TrackList/NoTrack";


/** Values defined by the MPRIS Player.PlaybackStatus property. */
export const PlaybackStatus = Object.freeze({
  PLAYING: "Playing",
  PAUSED: "Paused",
  STOPPED: "Stopped",
});

/** Values defined by the MPRIS Player.LoopStatus property. */
export const LoopStatus = Object.freeze({
  NONE: "None",
  TRACK: "Track",
  PLAYLIST: "Playlist",
});

const PLAYBACK_STATUSES = new Set(Object.values(PlaybackStatus));
const LOOP_STATUSES = new Set(Object.values(LoopStatus));

/** Normalizes a textual MPRIS property/hint to safe single-line text. */
export function normalizeMprisString(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Unknown PlaybackStatus values degrade to the protocol's Stopped state. */
export function normalizePlaybackStatus(value) {
  return PLAYBACK_STATUSES.has(value) ? value : PlaybackStatus.STOPPED;
}

/** Unknown LoopStatus values degrade to the protocol's None state. */
export function normalizeLoopStatus(value) {
  return LOOP_STATUSES.has(value) ? value : LoopStatus.NONE;
}

/** MPRIS metadata field names consumed by MediaShell. */
export const MprisMetadataKeys = Object.freeze({
  TRACK_ID: "mpris:trackid",
  LENGTH: "mpris:length",
  ART_URL: "mpris:artUrl",
  URL: "xesam:url",
  TITLE: "xesam:title",
  ARTIST: "xesam:artist",
  ALBUM: "xesam:album",
  ALBUM_ARTIST: "xesam:albumArtist",
  GENRE: "xesam:genre",
  CONTENT_CREATED: "xesam:contentCreated",
  COMPOSER: "xesam:composer",
  DISC_NUMBER: "xesam:discNumber",
  TRACK_NUMBER: "xesam:trackNumber",
});

/** Root-interface methods invoked by MediaShell. */
export const MprisRootMethods = Object.freeze({
  RAISE: "Raise",
  QUIT: "Quit",
});

/** Player-interface methods invoked by MediaShell. */
export const MprisPlayerMethods = Object.freeze({
  NEXT: "Next",
  PREVIOUS: "Previous",
  PAUSE: "Pause",
  PLAY_PAUSE: "PlayPause",
  STOP: "Stop",
  PLAY: "Play",
  SEEK: "Seek",
  SET_POSITION: "SetPosition",
});

/** Player-interface signals consumed by MediaShell. */
export const MprisPlayerSignals = Object.freeze({
  SEEKED: "Seeked",
});

/** Root-interface property names consumed by MediaShell. */
export const MprisRootProperties = Object.freeze({
  CAN_QUIT: "CanQuit",
  CAN_RAISE: "CanRaise",
  IDENTITY: "Identity",
  DESKTOP_ENTRY: "DesktopEntry",
});

/** Player-interface property names consumed by MediaShell. */
export const MprisPlayerProperties = Object.freeze({
  PLAYBACK_STATUS: "PlaybackStatus",
  LOOP_STATUS: "LoopStatus",
  RATE: "Rate",
  SHUFFLE: "Shuffle",
  METADATA: "Metadata",
  VOLUME: "Volume",
  POSITION: "Position",
  MINIMUM_RATE: "MinimumRate",
  MAXIMUM_RATE: "MaximumRate",
  CAN_GO_NEXT: "CanGoNext",
  CAN_GO_PREVIOUS: "CanGoPrevious",
  CAN_PLAY: "CanPlay",
  CAN_PAUSE: "CanPause",
  CAN_SEEK: "CanSeek",
  CAN_CONTROL: "CanControl",
});

/** Root-interface properties cached by MprisPlayer. */
export const MPRIS_ROOT_PROPERTY_NAMES = Object.freeze(
  Object.values(MprisRootProperties),
);

/** Player-interface properties cached by MprisPlayer. */
export const MPRIS_PLAYER_PROPERTY_NAMES = Object.freeze([
  MprisPlayerProperties.PLAYBACK_STATUS,
  MprisPlayerProperties.LOOP_STATUS,
  MprisPlayerProperties.RATE,
  MprisPlayerProperties.SHUFFLE,
  MprisPlayerProperties.METADATA,
  MprisPlayerProperties.VOLUME,
  MprisPlayerProperties.MINIMUM_RATE,
  MprisPlayerProperties.MAXIMUM_RATE,
  MprisPlayerProperties.CAN_GO_NEXT,
  MprisPlayerProperties.CAN_GO_PREVIOUS,
  MprisPlayerProperties.CAN_PLAY,
  MprisPlayerProperties.CAN_PAUSE,
  MprisPlayerProperties.CAN_SEEK,
  MprisPlayerProperties.CAN_CONTROL,
]);
