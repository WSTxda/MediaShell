/**
 * @file settingsBackupService.js
 * @module prefs.settings.settingsBackupService
 *
 * Exports and restores MediaShell preferences as a small versioned JSON backup.
 *
 * Backups contain only user GSettings values. Values are serialized through the
 * canonical GVariant text format so their exact types survive a round trip.
 * Import validates the complete document against the current schema before any
 * setting is staged, then commits the replacement through a temporary delayed
 * Gio.Settings instance.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

Gio._promisify(
  Gio.File.prototype,
  "load_contents_async",
  "load_contents_finish",
);
Gio._promisify(Gio.File.prototype, "query_info_async", "query_info_finish");
Gio._promisify(
  Gio.File.prototype,
  "replace_contents_bytes_async",
  "replace_contents_finish",
);

export const SETTINGS_BACKUP_FILENAME = "mediashell-settings.json";

const SETTINGS_BACKUP_FORMAT_VERSION = 1;
const MAX_SETTINGS_BACKUP_BYTES = 1024 * 1024;
const BACKUP_FILE_ATTRIBUTES = "standard::size";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidBackup(message, cause = null) {
  const error = new Error(message);
  if (cause) error.cause = cause;
  return error;
}

/** Owns preferences-side settings backup serialization and restoration. */
export default class SettingsBackupService {
  constructor(settings) {
    this.settings = settings;
    this.settingsSchema = settings.settings_schema;
    this.schemaId = this.settingsSchema.get_id();
  }

  createBackupDocument() {
    const serializedSettings = {};
    const keys = [...this.settingsSchema.list_keys()].sort();

    for (const key of keys) {
      const value = this.settings.get_user_value(key);
      if (!value) continue;

      serializedSettings[key] = {
        type: value.get_type_string(),
        value: value.print(true),
      };
    }

    return {
      format: SETTINGS_BACKUP_FORMAT_VERSION,
      schema: this.schemaId,
      created: GLib.DateTime.new_now_utc().format_iso8601(),
      settings: serializedSettings,
    };
  }

  async writeBackup(file, cancellable) {
    const document = this.createBackupDocument();
    const contents = `${JSON.stringify(document, null, 2)}\n`;
    const bytes = GLib.Bytes.new(new TextEncoder().encode(contents));

    await file.replace_contents_bytes_async(
      bytes,
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION,
      cancellable,
    );
  }

  async readBackup(file, cancellable) {
    const info = await file.query_info_async(
      BACKUP_FILE_ATTRIBUTES,
      Gio.FileQueryInfoFlags.NONE,
      GLib.PRIORITY_DEFAULT,
      cancellable,
    );
    if (info.get_size() > MAX_SETTINGS_BACKUP_BYTES)
      throw invalidBackup("Settings backup exceeds the supported size limit");

    const [contents] = await file.load_contents_async(cancellable);
    if (contents.length > MAX_SETTINGS_BACKUP_BYTES)
      throw invalidBackup("Settings backup exceeds the supported size limit");

    let document;
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      document = JSON.parse(decoder.decode(contents));
    } catch (error) {
      throw invalidBackup("Settings backup is not valid UTF-8 JSON", error);
    }

    return this.validateBackupDocument(document);
  }

  validateBackupDocument(document) {
    if (!isRecord(document))
      throw invalidBackup("Settings backup root must be an object");
    if (document.format !== SETTINGS_BACKUP_FORMAT_VERSION)
      throw invalidBackup("Unsupported settings backup format");
    if (document.schema !== this.schemaId)
      throw invalidBackup("Settings backup belongs to a different schema");
    if (typeof document.created !== "string")
      throw invalidBackup("Settings backup creation time is missing");
    if (!isRecord(document.settings))
      throw invalidBackup("Settings backup values are missing");

    const createdAt = GLib.DateTime.new_from_iso8601(document.created, null);
    if (!createdAt)
      throw invalidBackup("Settings backup creation time is invalid");

    const values = new Map();
    for (const [key, serializedValue] of Object.entries(document.settings)) {
      // A backup can outlive a setting. Unknown keys are intentionally ignored;
      // current settings absent from the backup return to their schema defaults.
      if (!this.settingsSchema.has_key(key)) continue;
      if (!isRecord(serializedValue))
        throw invalidBackup(`Invalid backup entry for setting: ${key}`);
      if (
        typeof serializedValue.type !== "string" ||
        typeof serializedValue.value !== "string"
      )
        throw invalidBackup(`Invalid backup value for setting: ${key}`);

      const schemaKey = this.settingsSchema.get_key(key);
      const expectedType = schemaKey.get_value_type();
      const expectedTypeString = schemaKey
        .get_default_value()
        .get_type_string();
      if (serializedValue.type !== expectedTypeString)
        throw invalidBackup(`Unexpected type for setting: ${key}`);

      let value;
      try {
        value = GLib.Variant.parse(
          expectedType,
          serializedValue.value,
          null,
          null,
        );
      } catch (error) {
        throw invalidBackup(`Could not parse setting: ${key}`, error);
      }

      if (!schemaKey.range_check(value))
        throw invalidBackup(`Out-of-range value for setting: ${key}`);

      values.set(key, value);
    }

    return Object.freeze({ createdAt, values });
  }

  restoreBackup(backup) {
    const restoreSettings = new Gio.Settings({
      settings_schema: this.settingsSchema,
    });
    restoreSettings.delay();

    try {
      for (const key of this.settingsSchema.list_keys())
        restoreSettings.reset(key);
      for (const [key, value] of backup.values) {
        if (!restoreSettings.set_value(key, value))
          throw new Error(`GSettings rejected backup value for: ${key}`);
      }
      restoreSettings.apply();
    } catch (error) {
      restoreSettings.revert();
      throw error;
    }
  }

  destroy() {
    this.settings = null;
    this.settingsSchema = null;
    this.schemaId = null;
  }
}
