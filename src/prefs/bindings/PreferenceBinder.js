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
import {
  connectOwnedSignal,
  disconnectOwnedSignals,
} from "../utils/signalConnections.js";
import { PREFERENCE_WIDGET_BINDINGS } from "./preferenceBindings.js";

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
    let syncingFromSetting = false;
    const syncFromSetting = () => {
      const action = normalizeInputAction(
        this.readEnumIndex(key),
        InputActions.NONE,
      );
      const selected = MOUSE_ACTION_INDEX_BY_VALUE[action] ?? 0;
      if (widget.selected === selected) return;

      syncingFromSetting = true;
      widget.selected = selected;
      syncingFromSetting = false;
    };

    syncFromSetting();
    this.connectOwnedSignal(widget, "notify::selected", () => {
      if (syncingFromSetting) return;

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
    return this.settings.get_enum(key);
  }

  writeEnumIndex(key, selectedIndex) {
    this.settings.set_enum(key, selectedIndex);
  }

  readAccelerator(key) {
    return this.settings.get_strv(key)[0] ?? "";
  }

  writeAccelerator(key, value) {
    this.settings.set_strv(key, [value]);
  }

  connectOwnedSignal(object, signal, callback) {
    connectOwnedSignal(this.ownedSignalConnections, object, signal, callback);
  }

  destroy() {
    disconnectOwnedSignals(this.ownedSignalConnections);

    for (const { widget, property } of this.nativeSettingsBindings)
      Gio.Settings.unbind(widget, property);
    this.nativeSettingsBindings.length = 0;
    this.settings = null;
    this.builder = null;
  }
}
