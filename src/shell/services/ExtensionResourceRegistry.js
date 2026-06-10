// Registers the extension GResource in the Shell process and unregisters it on disable.
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { createLogger } from "../../shared/utils/log.js";

const logger = createLogger("ExtensionResourceRegistry");

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
