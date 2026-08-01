/**
 * @file PreferenceBinder.js
 * @module prefs.bindings.PreferenceBinder
 *
 * Binds GSettings keys to preference widgets declared in preferenceBindings.
 *
 * The binder owns direct Gio.Settings bindings and the custom conversion hooks
 * required by widgets that cannot use a simple property binding. It also tracks
 * owned signal connections so preference teardown disconnects every callback in
 * a deterministic order.
 *
 * @see src/prefs/bindings/preferenceBindings.js
 */

import Gio from "gi://Gio";

import {
  MOUSE_ACTION_INDEX_BY_VALUE,
  MOUSE_ACTION_VALUES,
} from "../../shared/constants/inputActions.js";
import { normalizeInputAction } from "../../shared/utils/inputActions.js";
import { InputActions } from "../../shared/enums/input.js";
import { createLogger } from "../../shared/utils/log.js";
import {
  connectOwnedSignal,
  disconnectOwnedSignals,
} from "../utils/signalConnections.js";
import { PREFERENCE_WIDGET_BINDINGS } from "./preferenceBindings.js";

const logger = createLogger("PreferenceBinder");

/**
 * Binds GSettings keys to preference widgets declared in preferenceBindings.
 */
export default class PreferenceBinder {
  constructor(settings, builder) {
    this.settings = settings;
    this.builder = builder;
    this.ownedSignalConnections = [];
    this.nativeSettingsBindings = [];
  }

  bindAllPreferences() {
    for (const [key, widgetId, property] of PREFERENCE_WIDGET_BINDINGS)
      this.bindPreferenceWidget(key, widgetId, property);
  }

  bindPreferenceWidget(key, widgetId, property) {
    const widget = this.builder.get_object(widgetId);
    if (!widget) throw new Error(`Preferences widget not found: ${widgetId}`);

    if (property === "selected") {
      this.bindEnumIndex(key, widget);
      return;
    }

    if (property === "input-action-selected") {
      this.bindInputAction(key, widget);
      return;
    }

    if (property === "accelerator") {
      this.bindAccelerator(key, widget);
      return;
    }

    const flags =
      Gio.SettingsBindFlags.DEFAULT | Gio.SettingsBindFlags.NO_SENSITIVITY;
    this.settings.bind(key, widget, property, flags);
    this.nativeSettingsBindings.push({ widget, property });
  }

  bindEnumIndex(key, widget) {
    widget.selected = this.readEnumIndex(key);
    this.connectOwnedSignal(widget, "notify::selected", () => {
      if (this.readEnumIndex(key) !== widget.selected)
        this.writeEnumIndex(key, widget.selected);
    });
    this.connectOwnedSignal(this.settings, `changed::${key}`, () => {
      const selectedIndex = this.readEnumIndex(key);
      if (widget.selected !== selectedIndex) widget.selected = selectedIndex;
    });
  }

  bindInputAction(key, widget) {
    const syncFromSetting = () => {
      const action = normalizeInputAction(
        this.readEnumIndex(key),
        InputActions.NONE,
      );
      const selected = MOUSE_ACTION_INDEX_BY_VALUE[action] ?? 0;
      if (widget.selected !== selected) widget.selected = selected;
      if (this.readEnumIndex(key) !== action) this.writeEnumIndex(key, action);
    };

    syncFromSetting();
    this.connectOwnedSignal(widget, "notify::selected", () => {
      const action = MOUSE_ACTION_VALUES[widget.selected] ?? InputActions.NONE;
      if (this.readEnumIndex(key) !== action) this.writeEnumIndex(key, action);
    });
    this.connectOwnedSignal(this.settings, `changed::${key}`, syncFromSetting);
  }

  bindAccelerator(key, widget) {
    widget.accelerator = this.readAccelerator(key);
    this.connectOwnedSignal(widget, "notify::accelerator", () => {
      const current = this.readAccelerator(key);
      if (current !== widget.accelerator)
        this.writeAccelerator(key, widget.accelerator);
    });
    this.connectOwnedSignal(this.settings, `changed::${key}`, () => {
      const value = this.readAccelerator(key);
      if (widget.accelerator !== value) widget.accelerator = value;
    });
  }

  readEnumIndex(key) {
    try {
      return this.settings.get_enum(key);
    } catch (error) {
      logger.warn(`Failed to read enum setting ${key}; using index 0`, error);
      return 0;
    }
  }

  writeEnumIndex(key, selectedIndex) {
    try {
      this.settings.set_enum(key, selectedIndex);
    } catch (error) {
      logger.warn(`Failed to save enum setting ${key}`, error);
    }
  }

  readAccelerator(key) {
    try {
      return this.settings.get_strv(key)[0] ?? "";
    } catch (error) {
      logger.warn(
        `Failed to read shortcut setting ${key}; using no shortcut`,
        error,
      );
      return "";
    }
  }

  writeAccelerator(key, value) {
    try {
      this.settings.set_strv(key, [value]);
    } catch (error) {
      logger.warn(`Failed to save shortcut setting ${key}`, error);
    }
  }

  connectOwnedSignal(object, signal, callback) {
    connectOwnedSignal(this.ownedSignalConnections, object, signal, callback);
  }

  destroy() {
    disconnectOwnedSignals(this.ownedSignalConnections);

    for (const { widget, property } of this.nativeSettingsBindings) {
      try {
        Gio.Settings.unbind(widget, property);
      } catch {
        // Widget disposal may remove native bindings before binder teardown.
      }
    }
    this.nativeSettingsBindings.length = 0;
    this.settings = null;
    this.builder = null;
  }
}
