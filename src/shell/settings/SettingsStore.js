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

import { SETTINGS_SPEC } from "./settingsSpec.js";

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
    let value = this.settings[spec.read](key);
    if (spec.transform) value = spec.transform(value);

    this.settingsTarget[spec.property] = value;
    return value;
  }

  destroy() {
    if (!this.settings) return;

    for (const signalId of this.settingChangeSignalIds)
      this.settings.disconnect(signalId);
    this.settingChangeSignalIds.length = 0;
    this.settings = null;
    this.settingsTarget = null;
    this.onSettingChanged = null;
  }
}
