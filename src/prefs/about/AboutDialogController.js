/**
 * @file AboutDialogController.js
 * @module prefs.about.AboutDialogController
 *
 * Owns the About dialog button and Libadwaita about-window content.
 *
 * The controller connects the preferences header action to a lazily created
 * AboutDialog containing project metadata, donation links, and credits. It owns
 * the close signal so the transient dialog is released with the preferences
 * window.
 */

import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";

import {
  EXTENSION_ICON_NAME,
  EXTENSION_NAME,
  PROJECT_URLS,
} from "../../shared/constants/project.js";
import { createLogger } from "../../shared/utils/log.js";
import { gettext as _ } from "../translations.js";
import { PreferencesStyleClasses } from "../constants/styleClasses.js";

const logger = createLogger("AboutDialogController");

/**
 * Owns the About dialog button and Libadwaita about-window content.
 */
export default class AboutDialogController {
  constructor(preferencesInstance, preferencesWindow) {
    this.preferencesInstance = preferencesInstance;
    this.preferencesWindow = preferencesWindow;
    this.aboutButton = null;
    this.aboutButtonSignalId = null;
    this.headerBar = null;
  }

  init() {
    this.registerIconPath();
    this.headerBar = this.findHeaderBar(this.preferencesWindow);
    if (!this.headerBar) {
      logger.warn(
        "Preferences header bar was not found; About button was not added",
      );
      return;
    }

    this.aboutButton = new Gtk.Button({
      icon_name: "info-outline-symbolic",
      tooltip_text: _("About MediaShell"),
    });
    this.aboutButton.add_css_class(PreferencesStyleClasses.FLAT);
    this.aboutButtonSignalId = this.aboutButton.connect("clicked", () =>
      this.presentAboutDialog(),
    );
    this.headerBar.pack_start(this.aboutButton);
  }

  registerIconPath() {
    const display = Gdk.Display.get_default();
    if (!display) {
      logger.warn(
        "No display is available for registering the MediaShell icon path",
      );
      return;
    }

    const iconTheme = Gtk.IconTheme.get_for_display(display);
    const iconPath = this.preferencesInstance.dir.get_child("icons").get_path();
    if (iconPath && !iconTheme.get_search_path().includes(iconPath))
      iconTheme.add_search_path(iconPath);
  }

  findHeaderBar(widget) {
    if (widget instanceof Adw.HeaderBar || widget instanceof Gtk.HeaderBar)
      return widget;

    let child = widget.get_first_child?.();
    while (child) {
      const headerBar = this.findHeaderBar(child);
      if (headerBar) return headerBar;
      child = child.get_next_sibling();
    }
    return null;
  }

  presentAboutDialog() {
    const metadataVersion = this.preferencesInstance.metadata["version-name"];
    const fallbackVersion = this.preferencesInstance.metadata.version;
    const aboutDialog = new Adw.AboutDialog({
      application_name: EXTENSION_NAME,
      application_icon: EXTENSION_ICON_NAME,
      developer_name: "WSTxda",
      version: String(metadataVersion ?? fallbackVersion ?? ""),
      comments: _(
        "MediaShell is a GNOME Shell extension that adds configurable MPRIS media controls to the top bar. Its customizable popup displays album art, track information, playback controls, and a selector for switching between active media players. The top bar and popup can be configured independently, while GTK4 and Libadwaita preferences provide a consistent GNOME experience.",
      ),
      issue_url: PROJECT_URLS.ISSUES,
      copyright: "Copyright (c) 2026 WSTxda",
      license_type: Gtk.License.GPL_3_0,
    });

    aboutDialog.add_link("GitHub", PROJECT_URLS.REPOSITORY);
    aboutDialog.add_link(_("Donate"), PROJECT_URLS.DONATIONS);
    aboutDialog.add_credit_section(_("Developed by"), [
      "WSTxda https://github.com/WSTxda",
    ]);
    aboutDialog.add_credit_section("Media Controls", [
      `GitHub ${PROJECT_URLS.MEDIA_CONTROLS}`,
    ]);
    aboutDialog.present(this.preferencesWindow);
  }

  destroy() {
    if (this.aboutButton && this.aboutButtonSignalId !== null) {
      try {
        this.aboutButton.disconnect(this.aboutButtonSignalId);
      } catch {
        // The preferences window may dispose the button before controller teardown.
      }
    }
    this.aboutButtonSignalId = null;
    this.aboutButton = null;
    this.headerBar = null;
    this.preferencesWindow = null;
    this.preferencesInstance = null;
  }
}
