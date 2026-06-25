/**
 * @file OthersPageController.js
 * @module prefs.groups.OthersPageController
 *
 * Coordinates the preferences page for system integration and blocked apps.
 *
 * The controller owns rows that cannot be represented by a simple settings
 * binding, including the album-art cache action, the blocked-app list, and the
 * system media controls button row. It keeps those page-specific actions out of
 * the global PreferencesController.
 */
import Adw from "gi://Adw";
import GLib from "gi://GLib";
import { gettext as _, ngettext } from "../PreferencesTranslations.js";

import { migrateSettings } from "../../shared/settings/SettingsMigration.js";
import { createLogger } from "../../shared/utils/log.js";
import { connectOwnedSignal, disconnectOwnedSignals } from "../utils/SignalConnections.js";
import AlbumArtCacheService from "../utils/AlbumArtCacheService.js";

const logger = createLogger("OthersPageController");

export default class OthersPageController {
    constructor(settings, builder, preferencesWindow) {
        this.settings = settings;
        this.builder = builder;
        this.preferencesWindow = preferencesWindow;
        this.albumArtCacheService = new AlbumArtCacheService();
        this.ownedSignalConnections = [];
        this.albumArtCacheViewGeneration = 0;
        this.clearAlbumArtCachePromise = null;
        this.isDestroyed = false;
        this.openDialogs = new Set();
    }

    init() {
        this.clearAlbumArtCacheRow = this.builder.get_object("ar-others-clear-cache");
        this.clearAlbumArtCacheButton = this.builder.get_object("btn-others-clear-cache");
        this.blockedAppsGroup = this.builder.get_object("gp-others-blocked-apps");
        this.resetGroup = this.builder.get_object("gp-others-reset");
        this.createResetSettingsRow();

        this.blockedAppsGroup.setBlockedAppIds(this.settings.get_strv("blocked-apps"));
        this.connectOwnedSignal(this.blockedAppsGroup, "notify::blocked-app-ids", () => {
            this.settings.set_strv("blocked-apps", this.blockedAppsGroup.blockedAppIds);
        });
        this.connectOwnedSignal(this.clearAlbumArtCacheButton, "clicked", () =>
            this.presentClearAlbumArtCacheConfirmation(),
        );
        this.connectOwnedSignal(this.settings, "changed::blocked-apps", () => {
            const blockedAppIds = this.settings.get_strv("blocked-apps");
            if (JSON.stringify(blockedAppIds) !== JSON.stringify(this.blockedAppsGroup.blockedAppIds))
                this.blockedAppsGroup.setBlockedAppIds(blockedAppIds);
        });
        this.updateAlbumArtCacheStatsSubtitle();
    }

    createResetSettingsRow() {
        // Adw.ButtonRow requires Libadwaita 1.6, which is enforced by assertSupportedLibadwaita() in prefs.js
        this.resetSettingsRow = new Adw.ButtonRow({
            title: _("Reset all settings"),
            start_icon_name: "edit-undo-symbolic",
        });
        this.resetSettingsRow.add_css_class("destructive-action");
        this.resetGroup.add(this.resetSettingsRow);
        this.connectOwnedSignal(this.resetSettingsRow, "activated", () => this.presentResetSettingsConfirmation());
    }

    presentResetSettingsConfirmation() {
        this.presentDestructiveConfirmation(
            _("Reset all settings?"),
            _("Every MediaShell preference will return to its default value."),
            _("Reset"),
            () => this.resetAllSettings(),
        );
    }

    resetAllSettings() {
        for (const key of this.settings.settings_schema.list_keys()) this.settings.reset(key);
        migrateSettings(this.settings);
        this.preferencesWindow.add_toast(
            new Adw.Toast({
                title: _("Settings reset"),
                timeout: 3,
            }),
        );
    }

    presentClearAlbumArtCacheConfirmation() {
        this.presentDestructiveConfirmation(
            _("Clear the album art cache?"),
            _("Cached images will be downloaded again when needed."),
            _("Clear Cache"),
            () => this.clearAlbumArtCache(),
        );
    }

    presentDestructiveConfirmation(heading, body, confirmLabel, confirm) {
        const dialog = new Adw.AlertDialog({ heading, body });
        dialog.add_response("cancel", _("Cancel"));
        dialog.add_response("confirm", confirmLabel);
        dialog.set_response_appearance("confirm", Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.default_response = "cancel";
        dialog.close_response = "cancel";
        this.openDialogs.add(dialog);
        dialog.connect("response", (_dialog, response) => {
            this.openDialogs.delete(dialog);
            if (response === "confirm") confirm();
        });
        dialog.present(this.preferencesWindow);
    }

    clearAlbumArtCache() {
        if (this.clearAlbumArtCachePromise) return this.clearAlbumArtCachePromise;

        const albumArtCacheViewGeneration = ++this.albumArtCacheViewGeneration;
        this.clearAlbumArtCacheButton.sensitive = false;
        const clearPromise = this.performAlbumArtCacheClear(albumArtCacheViewGeneration).finally(() => {
            if (this.clearAlbumArtCachePromise === clearPromise) this.clearAlbumArtCachePromise = null;
            if (!this.isDestroyed) this.clearAlbumArtCacheButton.sensitive = true;
        });
        this.clearAlbumArtCachePromise = clearPromise;
        return clearPromise;
    }

    async performAlbumArtCacheClear(albumArtCacheViewGeneration) {
        try {
            await this.albumArtCacheService.clearAlbumArtCache();
            if (this.isDestroyed || albumArtCacheViewGeneration !== this.albumArtCacheViewGeneration) return;
            this.clearAlbumArtCacheRow.subtitle = this.formatAlbumArtCacheStats(0, 0);
            this.preferencesWindow.add_toast(
                new Adw.Toast({
                    title: _("Album art cache cleared"),
                    timeout: 3,
                }),
            );
        } catch (error) {
            if (this.isDestroyed || albumArtCacheViewGeneration !== this.albumArtCacheViewGeneration) return;
            logger.warn("Failed to clear the album-art cache", error);
            this.preferencesWindow.add_toast(
                new Adw.Toast({
                    title: _("Could not clear the album art cache"),
                    timeout: 3,
                }),
            );
            this.updateAlbumArtCacheStatsSubtitle();
        }
    }

    formatAlbumArtCacheStats(coverCount, totalBytes) {
        const format = ngettext("%d cover — %s", "%d covers — %s", coverCount);
        return format.format(coverCount, GLib.format_size(totalBytes));
    }

    async updateAlbumArtCacheStatsSubtitle() {
        const albumArtCacheViewGeneration = ++this.albumArtCacheViewGeneration;
        try {
            const { coverCount, totalBytes } = await this.albumArtCacheService.getAlbumArtCacheStats();
            if (!this.isDestroyed && albumArtCacheViewGeneration === this.albumArtCacheViewGeneration)
                this.clearAlbumArtCacheRow.subtitle = this.formatAlbumArtCacheStats(coverCount, totalBytes);
        } catch (error) {
            if (!this.isDestroyed && albumArtCacheViewGeneration === this.albumArtCacheViewGeneration)
                logger.warn("Failed to calculate the album-art cache statistics", error);
        }
    }

    connectOwnedSignal(object, signal, callback) {
        connectOwnedSignal(this.ownedSignalConnections, object, signal, callback);
    }

    destroy() {
        if (this.isDestroyed) return;

        this.isDestroyed = true;
        this.albumArtCacheViewGeneration++;
        for (const dialog of this.openDialogs) dialog.force_close();
        this.openDialogs.clear();
        disconnectOwnedSignals(this.ownedSignalConnections, (error) => {
            logger.debug("A preferences signal was already disconnected", error);
        });
        this.blockedAppsGroup?.destroy();
        this.albumArtCacheService.destroy();
        this.albumArtCacheService = null;
        this.clearAlbumArtCachePromise = null;
        this.settings = null;
        this.builder = null;
        this.preferencesWindow = null;
        this.clearAlbumArtCacheRow = null;
        this.clearAlbumArtCacheButton = null;
        this.blockedAppsGroup = null;
        this.resetGroup = null;
        this.resetSettingsRow = null;
        this.openDialogs = null;
    }
}
