/**
 * @file prefs.js
 * @module prefs
 *
 * GNOME Shell entry point for the MediaShell preferences process.
 *
 * Registers the compiled preferences resources, initializes Libadwaita, and
 * delegates window construction to PreferencesController. The file stays free of
 * Shell runtime imports because preferences run in a separate GTK process.
 *
 * @see src/prefs/PreferencesController.js
 */
import Adw from "gi://Adw";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { MINIMUM_LIBADWAITA_VERSION, isVersionAtLeast } from "./shared/constants/platform.js";
import { createLogger } from "./shared/utils/log.js";
import PreferencesController from "./prefs/PreferencesController.js";
import { initializePreferencesTranslations } from "./prefs/PreferencesTranslations.js";

const logger = createLogger("MediaShellPreferences");

function assertSupportedLibadwaita() {
    const major = Adw.get_major_version();
    const minor = Adw.get_minor_version();
    if (isVersionAtLeast(major, minor)) return;

    throw new Error(
        `MediaShell requires Libadwaita ${MINIMUM_LIBADWAITA_VERSION.major}.${MINIMUM_LIBADWAITA_VERSION.minor} or later; found ${major}.${minor}`,
    );
}

export default class MediaShellPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(preferencesWindow) {
        assertSupportedLibadwaita();
        initializePreferencesTranslations(this.gettext.bind(this), this.ngettext.bind(this));

        const preferencesController = new PreferencesController(this, preferencesWindow);
        await preferencesController.init().catch((error) => {
            logger.error("Failed to open preferences", error);
            preferencesController.destroy();
        });
    }
}
