// Adds the MediaShell About dialog to the preferences window header.
import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";
import { gettext as _ } from "../PreferencesTranslations.js";

import { createLogger } from "../../shared/utils/log.js";

const logger = createLogger("AboutDialogController");
const APP_ICON_NAME = "mediashell";
const GITHUB_URL = "https://github.com/WSTxda/MediaShell";
const DONATION_URL = "https://buymeacoffee.com/wstxda";
const ISSUE_URL = "https://github.com/WSTxda/MediaShell/issues";
const MEDIA_CONTROLS_CONTRIBUTORS_URL =
    "https://github.com/sakithb/media-controls/graphs/contributors?all=1";

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
            logger.warn("Preferences header bar was not found; About button was not added");
            return;
        }

        this.aboutButton = new Gtk.Button({
            icon_name: "info-outline-symbolic",
            tooltip_text: _("About MediaShell"),
        });
        this.aboutButton.add_css_class("flat");
        this.aboutButtonSignalId = this.aboutButton.connect("clicked", () => this.presentAboutDialog());
        this.headerBar.pack_start(this.aboutButton);
    }

    registerIconPath() {
        const display = Gdk.Display.get_default();
        if (!display) {
            logger.warn("No display is available for registering the MediaShell icon path");
            return;
        }

        const iconTheme = Gtk.IconTheme.get_for_display(display);
        const iconPath = this.preferencesInstance.dir.get_child("icons").get_path();
        if (iconPath && !iconTheme.get_search_path().includes(iconPath)) iconTheme.add_search_path(iconPath);
    }

    findHeaderBar(widget) {
        if (widget instanceof Adw.HeaderBar || widget instanceof Gtk.HeaderBar) return widget;

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
            application_name: "MediaShell",
            application_icon: APP_ICON_NAME,
            developer_name: "WSTxda",
            version: String(metadataVersion ?? fallbackVersion ?? ""),
            comments: _(
                "MediaShell integrates MPRIS-compatible media apps into the GNOME Shell top bar. It provides configurable track information, playback controls, album art, playback progress, app switching, and input actions without replacing GNOME's media stack.",
            ),
            issue_url: ISSUE_URL,
            copyright: "Copyright (c) 2026 WSTxda",
            license_type: Gtk.License.GPL_3_0,
        });

        aboutDialog.add_link("GitHub", GITHUB_URL);
        aboutDialog.add_link(_("Donate"), DONATION_URL);
        aboutDialog.add_credit_section(_("Developed by"), ["WSTxda https://github.com/WSTxda"]);
        aboutDialog.add_credit_section("Media Controls", [
            "Sakith B. https://github.com/sakithb",
            "Christian Lauinger https://github.com/ChrisLauinger77",
            "Winston Ma https://github.com/winstonma",
            "Ahmet Oğuzhan Kökülü https://github.com/Oguzhankokulu",
            `${_("View all...")} ${MEDIA_CONTROLS_CONTRIBUTORS_URL}`,
        ]);
        aboutDialog.present(this.preferencesWindow);
    }

    destroy() {
        if (this.aboutButton && this.aboutButtonSignalId != null) {
            try {
                this.aboutButton.disconnect(this.aboutButtonSignalId);
            } catch (error) {
                logger.debug("About button signal was already disconnected", error);
            }
        }
        this.aboutButtonSignalId = null;
        this.aboutButton = null;
        this.headerBar = null;
        this.preferencesWindow = null;
        this.preferencesInstance = null;
    }
}
