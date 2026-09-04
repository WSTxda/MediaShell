/**
 * @file resourceRegistry.js
 * @module shell.resources.resourceRegistry
 *
 * Registers compiled resources needed by the Shell runtime.
 *
 * ExtensionController uses this registry to expose bundled icons, UI assets, and
 * D-Bus introspection XML while the extension is enabled. The registry owns the
 * Gio.Resource handle and unregisters it during disable.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { COMPILED_RESOURCE_FILENAME } from "../../shared/resources.js";
import { createLogger } from "../../shared/logging/logger.js";

const logger = createLogger("ResourceRegistry");

/**
 * Registers compiled resources needed by the Shell runtime.
 */
export default class ResourceRegistry {
  constructor(extensionPath) {
    this.extensionPath = extensionPath;
    this.resource = null;
  }

  register() {
    if (this.resource) return;

    try {
      const resourcePath = GLib.build_filenamev([
        this.extensionPath,
        COMPILED_RESOURCE_FILENAME,
      ]);
      this.resource = Gio.resource_load(resourcePath);
      Gio.resources_register(this.resource);
    } catch (error) {
      logger.warn(
        "Failed to load compiled resources; extension will use theme fallbacks",
        error,
      );
      this.resource = null;
    }
  }

  destroy() {
    if (!this.resource) return;

    try {
      Gio.resources_unregister(this.resource);
    } catch (error) {
      logger.warn("Failed to unregister compiled resources", error);
    }
    this.resource = null;
    this.extensionPath = null;
  }
}
