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

import { MINIMUM_LIBADWAITA_VERSION } from "./shared/constants/platform.js";
import { isVersionAtLeast } from "./shared/utils/version.js";
import PreferencesController from "./prefs/PreferencesController.js";
import { initializePreferencesTranslations } from "./prefs/translations.js";

function assertSupportedLibadwaita() {
  const major = Adw.get_major_version();
  const minor = Adw.get_minor_version();
  if (isVersionAtLeast(major, minor)) return;

  throw new Error(
    `MediaShell requires Libadwaita ${MINIMUM_LIBADWAITA_VERSION.major}.${MINIMUM_LIBADWAITA_VERSION.minor} or later; found ${major}.${minor}`,
  );
}

/**
 * GNOME Shell entry point for the MediaShell preferences process.
 */
export default class MediaShellPreferences extends ExtensionPreferences {
  async fillPreferencesWindow(preferencesWindow) {
    assertSupportedLibadwaita();
    initializePreferencesTranslations(
      this.gettext.bind(this),
      this.ngettext.bind(this),
    );

    const preferencesController = new PreferencesController(
      this,
      preferencesWindow,
    );
    try {
      await preferencesController.init();
    } catch (error) {
      preferencesController.destroy();
      throw error;
    }
  }
}
