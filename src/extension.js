/**
 * @file extension.js
 * @module extension
 *
 * GNOME Shell entry point for the MediaShell runtime.
 *
 * Creates one MediaShellExtension instance per Shell lifecycle and delegates all
 * runtime work to ExtensionController. The entry point intentionally owns no UI
 * or D-Bus state itself so enable() and disable() stay small, auditable, and
 * aligned with GNOME Shell extension lifecycle rules.
 *
 * @see src/shell/extensionController.js
 */

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { createLogger } from "./shared/logging/logger.js";
import ExtensionController from "./shell/extensionController.js";

const logger = createLogger("MediaShellExtension");

/**
 * GNOME Shell entry point for the MediaShell runtime.
 */
export default class MediaShellExtension extends Extension {
  enable() {
    this.extensionController = new ExtensionController(this);
    this.extensionController
      .enable()
      .catch((error) =>
        logger.error("Unhandled extension startup failure", error),
      );
  }

  disable() {
    // `unlock-dialog` is required only for the optional lock-screen media enhancement.
    const extensionController = this.extensionController;
    this.extensionController = null;
    extensionController?.destroy();
  }
}
