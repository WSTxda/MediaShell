/**
 * @file dbus.js
 * @module shared.constants.dbus
 *
 * Defines D-Bus names, object paths, and canonical MPRIS property lists.
 *
 * These constants are shared by MPRIS proxy setup, validation, and pure utility
 * code. Property arrays mirror the freedesktop MPRIS interfaces and should only
 * change when MediaShell intentionally changes which remote properties it
 * hydrates from each endpoint.
 */

// --- D-Bus core interface ---

/** Interface name for the session D-Bus daemon used by ListNames and NameOwnerChanged. */
export const DBUS_IFACE_NAME = "org.freedesktop.DBus";

/** Object path for the session D-Bus daemon. */
export const DBUS_OBJECT_PATH = "/org/freedesktop/DBus";

/** Standard properties interface used to read and write MPRIS properties. */
export const DBUS_PROPERTIES_IFACE_NAME = "org.freedesktop.DBus.Properties";

/** D-Bus daemon methods used for media-app discovery. */
export const DbusMethods = Object.freeze({
  LIST_NAMES: "ListNames",
});

/** D-Bus daemon signals used for media-app discovery. */
export const DbusSignals = Object.freeze({
  NAME_OWNER_CHANGED: "NameOwnerChanged",
});

/** Standard org.freedesktop.DBus.Properties methods used by the runtime. */
export const DbusPropertiesMethods = Object.freeze({
  GET: "Get",
  SET: "Set",
});

// --- MPRIS service identity ---

/** Prefix shared by every MPRIS media app bus name. */
export const MPRIS_PREFIX = "org.mpris.MediaPlayer2.";

/** Root MPRIS interface implemented by the media app endpoint. */
export const MPRIS_IFACE_NAME = "org.mpris.MediaPlayer2";

/** MPRIS Player interface that exposes transport state, metadata, and controls. */
export const MPRIS_PLAYER_IFACE_NAME = "org.mpris.MediaPlayer2.Player";

/** Object path used by the root and Player interfaces in the MPRIS specification. */
export const MPRIS_OBJECT_PATH = "/org/mpris/MediaPlayer2";

/** Sentinel track path reported by MPRIS when no concrete track is available. */
export const MPRIS_NO_TRACK_PATH = "/org/mpris/MediaPlayer2/TrackList/NoTrack";

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

// --- MPRIS property hydration ---

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

/**
 * Root-interface properties cached by PlayerProxy.
 *
 * The list mirrors the values MediaShell needs for app identity and raise/quit
 * capability checks. Add properties here only when the runtime consumes them.
 */
export const ROOT_PROPERTIES = Object.freeze(
  Object.values(MprisRootProperties),
);

/**
 * Player-interface properties cached by PlayerProxy.
 *
 * These values drive top bar controls, popup state, metadata rendering, seeking,
 * and capability checks. Keeping the list explicit makes MPRIS support auditable
 * and avoids hydrating properties the extension does not use.
 */
export const PLAYER_PROPERTIES = Object.freeze([
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
