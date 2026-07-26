/**
 * @file SettingsStore.js
 * @module shell.settings.SettingsStore
 *
 * Wraps Gio.Settings with typed accessors and change-impact dispatch.
 *
 * ExtensionController and UI widgets read settings through this store instead of
 * touching raw schema keys directly. The store owns subscription callbacks and
 * logs setting changes before notifying runtime consumers.
 */

import { createLogger } from "../../shared/utils/log.js";
import { SETTINGS_SPEC } from "./settingsSpec.js";

const logger = createLogger("SettingsStore");

/**
 * Wraps Gio.Settings with typed accessors and change-impact dispatch.
 */
export default class SettingsStore {
  constructor(settings, settingsTarget, onSettingChanged) {
    this.settings = settings;
    this.settingsTarget = settingsTarget;
    this.onSettingChanged = onSettingChanged;
    this.settingChangeSignalIds = [];

    for (const [key, spec] of Object.entries(SETTINGS_SPEC)) {
      this.readSettingIntoTarget(key, spec);
      const signalId = this.settings.connect(`changed::${key}`, () => {
        const value = this.readSettingIntoTarget(key, spec);
        this.onSettingChanged?.(key, value, spec);
      });
      this.settingChangeSignalIds.push(signalId);
    }
  }

  readSettingIntoTarget(key, spec) {
    let value;
    try {
      value = this.settings[spec.read](key);
    } catch (error) {
      // A damaged user value should not prevent the extension from loading.
      logger.warn(`Failed to read setting ${key}; using a safe default`, error);
      value = this.readFallbackValue(key, spec);
    }

    const rawValue = value;

    try {
      if (spec.transform) value = spec.transform(value);
    } catch (error) {
      logger.warn(
        `Failed to normalize setting ${key}; using a safe default`,
        error,
      );
      value = this.readFallbackValue(key, spec);
      if (spec.transform) value = spec.transform(value);
    }

    if (spec.write && !Object.is(rawValue, value)) {
      try {
        this.settings[spec.write](key, value);
      } catch (error) {
        logger.warn(`Failed to repair setting ${key}`, error);
      }
    }

    this.settingsTarget[spec.property] = value;
    return value;
  }

  readFallbackValue(key, spec) {
    // Enum schema defaults unpack to their string nick, while get_enum()
    // normally returns an integer. Typed specification fallbacks preserve
    // the public runtime shape for those settings.
    if (spec.fallback !== undefined) return spec.fallback;

    try {
      const schemaDefault = this.settings
        .get_default_value(key)
        ?.recursiveUnpack?.();
      if (schemaDefault !== undefined) return schemaDefault;
    } catch (error) {
      logger.debugOnce(
        `schema-default:${key}`,
        `Schema default for ${key} could not be read`,
        error,
      );
    }

    return this.settingsTarget[spec.property];
  }

  destroy() {
    if (!this.settings) return;

    for (const signalId of this.settingChangeSignalIds) {
      try {
        this.settings.disconnect(signalId);
      } catch {
        // Gio.Settings may dispose handlers before the owner finishes teardown.
      }
    }
    this.settingChangeSignalIds.length = 0;
    this.settings = null;
    this.settingsTarget = null;
    this.onSettingChanged = null;
  }
}
