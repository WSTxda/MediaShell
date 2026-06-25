/**
 * @file dbus.js
 * @module shared.constants.dbus
 *
 * Defines D-Bus names, object paths, and canonical MPRIS property lists.
 *
 * These constants are shared by MPRIS proxy setup, validation, and pure utility
 * code. Property arrays mirror the freedesktop MPRIS interfaces and should only
 * change when the project intentionally changes which properties it hydrates.
 */

// --- D-Bus core interface ---

/** D-Bus daemon interface name used for ListNames and NameOwnerChanged */
export const DBUS_IFACE_NAME = "org.freedesktop.DBus";

/** D-Bus daemon object path */
export const DBUS_OBJECT_PATH = "/org/freedesktop/DBus";

/** Standard D-Bus properties interface name */
export const DBUS_PROPERTIES_IFACE_NAME = "org.freedesktop.DBus.Properties";

// --- MPRIS service identity ---

/** Prefix used by every MPRIS media-player bus name */
export const MPRIS_PREFIX = "org.mpris.MediaPlayer2.";

/** MPRIS root interface name */
export const MPRIS_IFACE_NAME = "org.mpris.MediaPlayer2";

/** MPRIS player interface name */
export const MPRIS_PLAYER_IFACE_NAME = "org.mpris.MediaPlayer2.Player";

/** MPRIS root and player object path */
export const MPRIS_OBJECT_PATH = "/org/mpris/MediaPlayer2";

/** MPRIS sentinel track path used when no concrete track is available */
export const MPRIS_NO_TRACK_PATH = "/org/mpris/MediaPlayer2/TrackList/NoTrack";

// --- MPRIS root interface properties ---

/** Root interface properties hydrated from org.mpris.MediaPlayer2 */
export const ROOT_PROPERTIES = Object.freeze([
    "CanQuit",
    "Fullscreen",
    "CanSetFullscreen",
    "CanRaise",
    "HasTrackList",
    "Identity",
    "DesktopEntry",
    "SupportedUriSchemes",
    "SupportedMimeTypes",
]);

// --- MPRIS player interface properties ---

/** Player interface properties hydrated from org.mpris.MediaPlayer2.Player */
export const PLAYER_PROPERTIES = Object.freeze([
    "PlaybackStatus",
    "LoopStatus",
    "Rate",
    "Shuffle",
    "Metadata",
    "Volume",
    "MinimumRate",
    "MaximumRate",
    "CanGoNext",
    "CanGoPrevious",
    "CanPlay",
    "CanPause",
    "CanSeek",
    "CanControl",
]);
