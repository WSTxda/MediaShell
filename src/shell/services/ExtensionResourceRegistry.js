/**
 * @file ExtensionResourceRegistry.js
 * @module shell.services.ExtensionResourceRegistry
 *
 * Registers compiled resources needed by the Shell runtime.
 *
 * ExtensionController uses this service to expose bundled icons, UI assets, and
 * D-Bus introspection XML while the extension is enabled. The registry owns the
 * Gio.Resource handle and unregisters it during disable.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { createLogger } from "../../shared/utils/log.js";

const logger = createLogger("ExtensionResourceRegistry");

/**
 * Registers compiled resources needed by the Shell runtime.
 */
export default class ExtensionResourceRegistry {
    constructor(extensionPath) {
        this.extensionPath = extensionPath;
        this.resource = null;
    }

    register() {
        if (this.resource) return;

        const resourcePath = GLib.build_filenamev([
            this.extensionPath,
            "org.gnome.shell.extensions.mediashell.gresource",
        ]);
        this.resource = Gio.resource_load(resourcePath);
        Gio.resources_register(this.resource);
        logger.debug("Registered extension resources");
    }

    destroy() {
        if (!this.resource) return;

        try {
            Gio.resources_unregister(this.resource);
            logger.debug("Unregistered extension resources");
        } catch (error) {
            logger.debug("Resources were already unavailable during teardown", error);
        }
        this.resource = null;
        this.extensionPath = null;
    }
}
