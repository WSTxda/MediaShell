/**
 * @file PreferencesResourceLoader.js
 * @module prefs.resources.PreferencesResourceLoader
 *
 * Registers and unregisters compiled resources used by the preferences process.
 *
 * The loader keeps GtkBuilder templates, images, and other bundled assets
 * available while the preferences window is open. It mirrors the Shell-side
 * resource registry but is scoped to the GTK preferences process.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { createLogger } from "../../shared/utils/log.js";

const logger = createLogger("PreferencesResourceLoader");
let registeredResource = null;

/**
 * Registers the compiled preferences resource bundle.
 *
 * Registration is idempotent because GNOME can open preferences more than once
 * in the same process. The returned Gio.Resource is kept for the process lifetime
 * so GtkBuilder templates and bundled images remain available while dialogs are
 * open.
 *
 * @param {string} extensionPath - Absolute extension directory path.
 * @returns {Gio.Resource} Registered preferences resource.
 */
export function registerPreferencesResources(extensionPath) {
    if (registeredResource) return registeredResource;

    const resourcePath = GLib.build_filenamev([extensionPath, "org.gnome.shell.extensions.mediashell.gresource"]);
    registeredResource = Gio.resource_load(resourcePath);
    Gio.resources_register(registeredResource);
    logger.debug("Registered preference resources");
    return registeredResource;
}
