// Registers the shared GResource once in the long-lived preferences process.
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { createLogger } from "../../shared/utils/log.js";

const logger = createLogger("PreferencesResourceLoader");
let registeredResource = null;

export function registerPreferencesResources(extensionPath) {
    if (registeredResource) return registeredResource;

    const resourcePath = GLib.build_filenamev([extensionPath, "org.gnome.shell.extensions.mediashell.gresource"]);
    registeredResource = Gio.resource_load(resourcePath);
    Gio.resources_register(registeredResource);
    logger.debug("Registered preference resources");
    return registeredResource;
}
