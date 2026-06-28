/**
 * @file PreferenceBinder.js
 * @module prefs.bindings.PreferenceBinder
 *
 * Binds GSettings keys to preference widgets declared in PreferenceBindings.
 *
 * The binder owns direct Gio.Settings bindings and the custom conversion hooks
 * required by widgets that cannot use a simple property binding. It also tracks
 * owned signal connections so preference teardown disconnects every callback in
 * a deterministic order.
 *
 * @see src/prefs/bindings/PreferenceBindings.js
 */

import Gio from "gi://Gio";

import { createLogger } from "../../shared/utils/log.js";
import { connectOwnedSignal, disconnectOwnedSignals } from "../utils/SignalConnections.js";
import { PREFERENCE_WIDGET_BINDINGS } from "./PreferenceBindings.js";

const logger = createLogger("PreferenceBinder");

/**
 * Binds GSettings keys to preference widgets declared in PreferenceBindings.
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
        logger.debug("Bound preference settings", PREFERENCE_WIDGET_BINDINGS.length);
    }

    bindPreferenceWidget(key, widgetId, property) {
        // GSettings key: `key` from PREFERENCE_WIDGET_BINDINGS
        const widget = this.builder.get_object(widgetId);
        if (!widget) throw new Error(`Preferences widget not found: ${widgetId}`);

        if (property === "selected") {
            widget.selected = this.readEnumIndex(key);
            this.connectOwnedSignal(widget, "notify::selected", () => {
                if (this.readEnumIndex(key) !== widget.selected) this.writeEnumIndex(key, widget.selected);
            });
            this.connectOwnedSignal(this.settings, `changed::${key}`, () => {
                const selectedIndex = this.readEnumIndex(key);
                if (widget.selected !== selectedIndex) widget.selected = selectedIndex;
            });
            return;
        }

        if (property === "accelerator") {
            widget.accelerator = this.readAccelerator(key);
            this.connectOwnedSignal(widget, "notify::accelerator", () => {
                const current = this.readAccelerator(key);
                if (current !== widget.accelerator) this.writeAccelerator(key, widget.accelerator);
            });
            this.connectOwnedSignal(this.settings, `changed::${key}`, () => {
                const value = this.readAccelerator(key);
                if (widget.accelerator !== value) widget.accelerator = value;
            });
            return;
        }

        const flags = Gio.SettingsBindFlags.DEFAULT | Gio.SettingsBindFlags.NO_SENSITIVITY;
        this.settings.bind(key, widget, property, flags);
        this.nativeSettingsBindings.push({ widget, property });
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
            logger.warn(`Failed to read shortcut setting ${key}; using no shortcut`, error);
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
        disconnectOwnedSignals(this.ownedSignalConnections, (error) => {
            logger.debug("A preferences signal was already disconnected", error);
        });

        for (const { widget, property } of this.nativeSettingsBindings) {
            try {
                Gio.Settings.unbind(widget, property);
            } catch (error) {
                logger.debug("A native GSettings binding was already removed", error);
            }
        }
        this.nativeSettingsBindings.length = 0;
        this.settings = null;
        this.builder = null;
    }
}
