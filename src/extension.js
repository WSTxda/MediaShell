// GNOME Shell entry point; delegates all runtime ownership to ExtensionController.
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { createLogger } from "./shared/utils/log.js";
import ExtensionController from "./shell/ExtensionController.js";

const logger = createLogger("MediaShellExtension");

export default class MediaShellExtension extends Extension {
    enable() {
        this.extensionController = new ExtensionController(this);
        this.extensionController.enable().catch((error) => logger.error("Unhandled extension startup failure", error));
    }

    disable() {
        const extensionController = this.extensionController;
        this.extensionController = null;
        try {
            extensionController?.destroy();
        } catch (error) {
            logger.error("Unhandled extension teardown failure", error);
        }
    }
}
