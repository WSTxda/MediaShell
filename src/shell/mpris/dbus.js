/**
 * @file dbus.js
 * @module shell.mpris.dbus
 *
 * Defines the core D-Bus daemon and Properties interface contracts used by
 * MediaShell. MPRIS-specific names and property lists live in protocol.js.
 */

/** Interface name for the session D-Bus daemon used by ListNames and NameOwnerChanged. */
export const DBUS_DAEMON_IFACE_NAME = "org.freedesktop.DBus";

/** Object path for the session D-Bus daemon. */
export const DBUS_DAEMON_OBJECT_PATH = "/org/freedesktop/DBus";

/** Standard properties interface used to read and write remote properties. */
export const DBUS_PROPERTIES_IFACE_NAME = "org.freedesktop.DBus.Properties";

/** D-Bus daemon methods used for MPRIS player discovery. */
export const DBusDaemonMethods = Object.freeze({
  LIST_NAMES: "ListNames",
});

/** D-Bus daemon signals used for MPRIS player discovery. */
export const DBusDaemonSignals = Object.freeze({
  NAME_OWNER_CHANGED: "NameOwnerChanged",
});

/** Standard org.freedesktop.DBus.Properties methods used by the runtime. */
export const DBusPropertiesMethods = Object.freeze({
  GET: "Get",
  SET: "Set",
});
