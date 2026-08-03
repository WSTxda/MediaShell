/**
 * @file PreferencesController.js
 * @module prefs.PreferencesController
 *
 * Builds and owns the full Libadwaita preferences window.
 *
 * The controller loads the GtkBuilder UI, registers custom widgets, wires every
 * preference page controller, and destroys them when the window closes. It is
 * the single preferences-side coordinator, so page controllers can stay focused
 * on their own settings groups.
 */

import Gtk from "gi://Gtk";

import { ResourcePaths } from "../shared/constants/resources.js";
import AboutDialogController from "./about/AboutDialogController.js";
import PreferenceBinder from "./bindings/PreferenceBinder.js";
import InteractionsPageController from "./controllers/InteractionsPageController.js";
import OthersPageController from "./controllers/OthersPageController.js";
import PopupLayoutController from "./controllers/PopupLayoutController.js";
import PreferenceSensitivityController from "./controllers/PreferenceSensitivityController.js";
import TopBarLayoutController from "./controllers/TopBarLayoutController.js";
import TrackInformationContentController from "./controllers/TrackInformationContentController.js";
import { PREFERENCE_PAGE_IDS } from "./constants/ui.js";
import { registerPreferencesResources } from "./resources/preferencesResourceLoader.js";

/**
 * Builds and owns the full Libadwaita preferences window.
 */
export default class PreferencesController {
  constructor(preferencesInstance, preferencesWindow) {
    this.preferencesInstance = preferencesInstance;
    this.preferencesWindow = preferencesWindow;
    this.closeSignalId = null;
    this.ownedControllers = [];
  }

  async init() {
    const preferencesWindow = this.preferencesWindow;
    registerPreferencesResources(this.preferencesInstance.path);
    const { ensurePreferenceWidgetsRegistered } =
      await import("./widgets/widgetRegistry.js");
    if (this.preferencesWindow !== preferencesWindow) return;
    ensurePreferenceWidgetsRegistered();

    this.settings = this.preferencesInstance.getSettings();
    this.builder = Gtk.Builder.new_from_resource(ResourcePaths.PREFERENCES_UI);

    for (const pageId of PREFERENCE_PAGE_IDS) {
      const page = this.builder.get_object(pageId);
      if (!page) throw new Error(`Preferences page not found: ${pageId}`);
      preferencesWindow.add(page);
    }

    this.preferenceBinder = new PreferenceBinder(this.settings, this.builder);
    this.preferenceBinder.bindAllPreferences();

    this.ownedControllers = [
      new PopupLayoutController(this.settings, this.builder),
      new PreferenceSensitivityController(this.builder),
      new TopBarLayoutController(this.settings, this.builder),
      new TrackInformationContentController(this.settings, this.builder),
      new InteractionsPageController(
        this.settings,
        this.builder,
        preferencesWindow,
      ),
      new OthersPageController(this.settings, this.builder, preferencesWindow),
      new AboutDialogController(this.preferencesInstance, preferencesWindow),
    ];
    for (const controller of this.ownedControllers) controller.init();

    this.closeSignalId = preferencesWindow.connect("close-request", () => {
      this.destroy();
      return false;
    });
  }

  destroy() {
    const preferencesWindow = this.preferencesWindow;
    if (!preferencesWindow) return;
    this.preferencesWindow = null;

    if (this.closeSignalId !== null)
      preferencesWindow.disconnect(this.closeSignalId);
    this.closeSignalId = null;

    const ownedControllers = this.ownedControllers;
    this.ownedControllers = [];
    for (const controller of [...ownedControllers].reverse())
      controller.destroy();

    const preferenceBinder = this.preferenceBinder;
    this.preferenceBinder = null;
    preferenceBinder?.destroy();

    this.settings = null;
    this.builder = null;
    this.preferencesInstance = null;
  }
}
