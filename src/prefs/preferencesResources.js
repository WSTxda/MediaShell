/**
 * @file preferencesResources.js
 * @module prefs.preferencesResources
 *
 * Registers compiled resources used by the preferences process.
 *
 * This adapter keeps GtkBuilder templates and other bundled assets available for
 * the lifetime of the GTK preferences process. Registration is intentionally
 * idempotent and has no per-window unregister step.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { COMPILED_RESOURCE_FILENAME } from "../shared/constants/resources.js";

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

  const resourcePath = GLib.build_filenamev([
    extensionPath,
    COMPILED_RESOURCE_FILENAME,
  ]);
  registeredResource = Gio.resource_load(resourcePath);
  Gio.resources_register(registeredResource);
  return registeredResource;
}
