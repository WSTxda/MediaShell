// Applies the declarative preferences bindings and owns every signal created for them.
import Gio from "gi://Gio";

import { createLogger } from "../../shared/utils/log.js";
import { PREFERENCE_WIDGET_BINDINGS } from "./PreferenceBindings.js";

const logger = createLogger("PreferenceBinder");

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
        const signalId = object.connect(signal, callback);
        this.ownedSignalConnections.push({ object, signalId });
    }

    destroy() {
        for (const { object, signalId } of this.ownedSignalConnections) {
            try {
                object.disconnect(signalId);
            } catch (error) {
                logger.debug("A preferences signal was already disconnected", error);
            }
        }
        this.ownedSignalConnections.length = 0;

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
