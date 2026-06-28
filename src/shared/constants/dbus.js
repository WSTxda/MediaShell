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

// --- MPRIS property hydration ---

/**
 * Root-interface properties cached by PlayerProxy.
 *
 * The list mirrors the values MediaShell needs for app identity, raising/quitting
 * support, and root capability checks. Add properties here only when the runtime
 * actually consumes them.
 */
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

/**
 * Player-interface properties cached by PlayerProxy.
 *
 * These values drive top bar controls, popup state, metadata rendering, seeking,
 * and capability checks. Keeping the list explicit makes MPRIS support auditable
 * and avoids hydrating properties the extension does not use.
 */
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
