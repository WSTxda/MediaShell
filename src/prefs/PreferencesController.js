// Builds the preferences window and owns every binder and preferences controller.
import Gtk from "gi://Gtk";

import { migrateSettings, SETTINGS_SCHEMA_VERSION } from "../shared/settings/SettingsMigration.js";
import { createLogger } from "../shared/utils/log.js";
import AboutDialogController from "./about/AboutDialogController.js";
import PreferenceBinder from "./bindings/PreferenceBinder.js";
import KeyboardShortcutsController from "./groups/KeyboardShortcutsController.js";
import TopBarStructureController from "./groups/TopBarStructureController.js";
import OthersPageController from "./groups/OthersPageController.js";
import PreferenceSensitivityController from "./groups/PreferenceSensitivityController.js";
import { registerPreferencesResources } from "./resources/PreferencesResourceLoader.js";

const logger = createLogger("PreferencesController");
const PREFERENCE_PAGE_IDS = ["page-popup", "page-top-bar", "page-panel", "page-interactions", "page-others"];

export default class PreferencesController {
    constructor(preferencesInstance, preferencesWindow) {
        this.preferencesInstance = preferencesInstance;
        this.preferencesWindow = preferencesWindow;
        this.destroyed = false;
        this.ownedControllers = [];
    }

    async init() {
        registerPreferencesResources(this.preferencesInstance.path);
        const { ensurePreferenceWidgetsRegistered } = await import("./widgets/WidgetRegistry.js");
        if (this.destroyed) return;
        ensurePreferenceWidgetsRegistered();

        this.settings = this.preferencesInstance.getSettings();
        if (migrateSettings(this.settings))
            logger.debug("Settings migrated to schema version", SETTINGS_SCHEMA_VERSION);
        this.builder = Gtk.Builder.new_from_resource("/org/gnome/shell/extensions/mediashell/ui/prefs.ui");

        for (const pageId of PREFERENCE_PAGE_IDS) {
            const page = this.builder.get_object(pageId);
            if (!page) throw new Error(`Preferences page not found: ${pageId}`);
            this.preferencesWindow.add(page);
        }

        this.preferenceBinder = new PreferenceBinder(this.settings, this.builder);
        this.preferenceBinder.bindAllPreferences();

        this.ownedControllers = [
            new PreferenceSensitivityController(this.builder),
            new TopBarStructureController(this.settings, this.builder),
            new KeyboardShortcutsController(this.settings, this.builder, this.preferencesWindow),
            new OthersPageController(this.settings, this.builder, this.preferencesWindow),
            new AboutDialogController(this.preferencesInstance, this.preferencesWindow),
        ];
        for (const controller of this.ownedControllers) controller.init();

        this.closeSignalId = this.preferencesWindow.connect("close-request", () => {
            this.destroy();
            return false;
        });
        logger.debug("Preferences window initialized");
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;

        if (this.preferencesWindow && this.closeSignalId != null) {
            try {
                this.preferencesWindow.disconnect(this.closeSignalId);
            } catch (error) {
                logger.debug("Preferences close signal was already disconnected", error);
            }
        }
        this.closeSignalId = null;

        for (const controller of this.ownedControllers.reverse()) {
            try {
                controller.destroy();
            } catch (error) {
                logger.warn("A preferences controller failed during teardown", error);
            }
        }
        this.ownedControllers.length = 0;

        try {
            this.preferenceBinder?.destroy();
        } catch (error) {
            logger.warn("Preference binder failed during teardown", error);
        }
        this.preferenceBinder = null;
        this.settings = null;
        this.builder = null;
        this.preferencesWindow = null;
        this.preferencesInstance = null;
        logger.debug("Preferences window destroyed");
    }
}
