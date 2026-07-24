/**
 * @file resources.js
 * @module shared.constants.resources
 *
 * Defines compiled resource identity and bundled runtime paths.
 *
 * Shell services, preferences loaders, Gtk templates, and D-Bus proxy creation
 * import these values so the GResource prefix and packaged filename cannot drift
 * between process-specific consumers.
 */

/** Filename emitted by glib-compile-resources and shipped in the extension root. */
export const COMPILED_RESOURCE_FILENAME =
  "org.gnome.shell.extensions.mediashell.gresource";

/** Canonical GResource path prefix declared by the XML resource manifest. */
export const RESOURCE_PATH_PREFIX = "/org/gnome/shell/extensions/mediashell";

/** Bundled resource paths consumed through Gio resource lookup. */
export const ResourcePaths = Object.freeze({
  PREFERENCES_UI: `${RESOURCE_PATH_PREFIX}/ui/prefs.ui`,
});

/** Bundled resource URIs consumed by Gio.File and Gtk template registration. */
export const ResourceUris = Object.freeze({
  MPRIS_INTROSPECTION: `resource://${RESOURCE_PATH_PREFIX}/dbus/mprisNode.xml`,
  DBUS_WATCH_INTROSPECTION: `resource://${RESOURCE_PATH_PREFIX}/dbus/watchNode.xml`,
  BLOCKED_APPS_UI: `resource://${RESOURCE_PATH_PREFIX}/ui/blocked-apps.ui`,
  TOP_BAR_ELEMENT_ORDER_UI: `resource://${RESOURCE_PATH_PREFIX}/ui/top-bar-element-order.ui`,
  TRACK_INFORMATION_CONTENT_ROW_UI: `resource://${RESOURCE_PATH_PREFIX}/ui/track-information-content-row.ui`,
});
