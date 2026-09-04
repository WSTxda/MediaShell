/**
 * @file othersPageController.js
 * @module prefs.controllers.othersPageController
 *
 * Coordinates the preferences page for system integration and blocked apps.
 *
 * The controller owns rows that cannot be represented by a simple settings
 * binding, including the album-art cache action and the blocked-app list. The
 * GNOME media-control switches remain declarative bindings; page-specific
 * maintenance and confirmation flows stay out of PreferencesController.
 */

import Adw from "gi://Adw";
import GLib from "gi://GLib";

import { SettingsKeys } from "../../shared/settings/contract.js";
import { createLogger } from "../../shared/logging/logger.js";
import { gettext as _, ngettext } from "../translations.js";
import { TOAST_TIMEOUT_SECONDS } from "../constants/preferencesUi.js";
import { PreferencesStyleClasses } from "../constants/styleClasses.js";
import AlbumArtCacheService from "../services/albumArtCacheService.js";
import {
  connectOwnedSignal,
  disconnectOwnedSignals,
} from "../utils/signalConnections.js";

const logger = createLogger("OthersPageController");

/**
 * Coordinates the preferences page for system integration and blocked apps.
 */
export default class OthersPageController {
  constructor(settings, builder, preferencesWindow) {
    this.settings = settings;
    this.builder = builder;
    this.preferencesWindow = preferencesWindow;
    this.albumArtCacheService = new AlbumArtCacheService();
    this.ownedSignalConnections = [];
    this.albumArtCacheViewGeneration = 0;
    this.clearAlbumArtCachePromise = null;
    this.openDialogs = new Set();
  }

  init() {
    this.clearAlbumArtCacheRow = this.builder.get_object(
      "ar-album-art-cache-clear",
    );
    this.clearAlbumArtCacheButton = this.builder.get_object(
      "btn-album-art-cache-clear",
    );
    this.blockedAppsGroup = this.builder.get_object("gp-blocked-apps");
    this.resetGroup = this.builder.get_object("gp-reset-settings");
    this.createResetSettingsRow();

    this.blockedAppsGroup.setBlockedAppIds(
      this.settings.get_strv(SettingsKeys.BLOCKED_APPS),
    );
    this.connectOwnedSignal(
      this.blockedAppsGroup,
      "notify::blocked-app-ids",
      () => {
        this.settings.set_strv(
          SettingsKeys.BLOCKED_APPS,
          this.blockedAppsGroup.blockedAppIds,
        );
      },
    );
    this.connectOwnedSignal(this.clearAlbumArtCacheButton, "clicked", () =>
      this.presentClearAlbumArtCacheConfirmation(),
    );
    this.connectOwnedSignal(
      this.settings,
      `changed::${SettingsKeys.BLOCKED_APPS}`,
      () => {
        const blockedAppIds = this.settings.get_strv(SettingsKeys.BLOCKED_APPS);
        if (
          JSON.stringify(blockedAppIds) !==
          JSON.stringify(this.blockedAppsGroup.blockedAppIds)
        )
          this.blockedAppsGroup.setBlockedAppIds(blockedAppIds);
      },
    );
    this.updateAlbumArtCacheStatsSubtitle();
  }

  createResetSettingsRow() {
    // Adw.ButtonRow requires Libadwaita 1.6 or later; MediaShell's 1.7 floor
    // (enforced by assertSupportedLibadwaita() in prefs.js) already covers it.
    this.resetSettingsRow = new Adw.ButtonRow({
      title: _("Reset all settings"),
      start_icon_name: "edit-undo-symbolic",
    });
    this.resetSettingsRow.add_css_class(
      PreferencesStyleClasses.DESTRUCTIVE_ACTION,
    );
    this.resetGroup.add(this.resetSettingsRow);
    this.connectOwnedSignal(this.resetSettingsRow, "activated", () =>
      this.presentResetSettingsConfirmation(),
    );
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
    for (const key of this.settings.settings_schema.list_keys())
      this.settings.reset(key);
    this.preferencesWindow.add_toast(
      new Adw.Toast({
        title: _("Settings reset"),
        timeout: TOAST_TIMEOUT_SECONDS,
      }),
    );
  }

  presentClearAlbumArtCacheConfirmation() {
    this.presentDestructiveConfirmation(
      _("Clear the cache?"),
      _("Cached content will be downloaded again when needed."),
      _("Clear cache"),
      () => this.clearAlbumArtCache(),
    );
  }

  presentDestructiveConfirmation(heading, body, confirmLabel, confirm) {
    if (!this.preferencesWindow) return;

    const dialog = new Adw.AlertDialog({ heading, body });
    dialog.add_response("cancel", _("Cancel"));
    dialog.add_response("confirm", confirmLabel);
    dialog.set_response_appearance(
      "confirm",
      Adw.ResponseAppearance.DESTRUCTIVE,
    );
    dialog.default_response = "cancel";
    dialog.close_response = "cancel";
    this.openDialogs.add(dialog);
    dialog.connect("response", (_dialog, response) => {
      if (!this.openDialogs.delete(dialog)) return;
      if (response === "confirm") confirm();
    });
    dialog.present(this.preferencesWindow);
  }

  clearAlbumArtCache() {
    if (this.clearAlbumArtCachePromise) return this.clearAlbumArtCachePromise;
    if (!this.clearAlbumArtCacheButton) return null;

    const albumArtCacheViewGeneration = ++this.albumArtCacheViewGeneration;
    const clearAlbumArtCacheButton = this.clearAlbumArtCacheButton;
    clearAlbumArtCacheButton.sensitive = false;
    const clearPromise = this.performAlbumArtCacheClear(
      albumArtCacheViewGeneration,
    ).finally(() => {
      if (this.clearAlbumArtCachePromise === clearPromise)
        this.clearAlbumArtCachePromise = null;
      if (this.clearAlbumArtCacheButton === clearAlbumArtCacheButton)
        clearAlbumArtCacheButton.sensitive = true;
    });
    this.clearAlbumArtCachePromise = clearPromise;
    return clearPromise;
  }

  async performAlbumArtCacheClear(albumArtCacheViewGeneration) {
    try {
      await this.albumArtCacheService.clearAlbumArtCache();
      if (albumArtCacheViewGeneration !== this.albumArtCacheViewGeneration)
        return;
      this.clearAlbumArtCacheRow.subtitle = this.formatAlbumArtCacheStats(0, 0);
      this.preferencesWindow.add_toast(
        new Adw.Toast({
          title: _("Cache cleared"),
          timeout: TOAST_TIMEOUT_SECONDS,
        }),
      );
    } catch (error) {
      if (albumArtCacheViewGeneration !== this.albumArtCacheViewGeneration)
        return;
      logger.warn("Failed to clear the album-art cache", error);
      this.preferencesWindow.add_toast(
        new Adw.Toast({
          title: _("Could not clear the cache"),
          timeout: TOAST_TIMEOUT_SECONDS,
        }),
      );
      this.updateAlbumArtCacheStatsSubtitle();
    }
  }

  formatAlbumArtCacheStats(cachedImageCount, totalBytes) {
    const format = ngettext(
      "%d cached image — %s",
      "%d cached images — %s",
      cachedImageCount,
    );
    return format.format(cachedImageCount, GLib.format_size(totalBytes));
  }

  async updateAlbumArtCacheStatsSubtitle() {
    const albumArtCacheViewGeneration = ++this.albumArtCacheViewGeneration;
    try {
      const { cachedImageCount, totalBytes } =
        await this.albumArtCacheService.getAlbumArtCacheStats();
      if (albumArtCacheViewGeneration === this.albumArtCacheViewGeneration)
        this.clearAlbumArtCacheRow.subtitle = this.formatAlbumArtCacheStats(
          cachedImageCount,
          totalBytes,
        );
    } catch (error) {
      if (albumArtCacheViewGeneration === this.albumArtCacheViewGeneration)
        logger.warn(
          "Failed to calculate the album-art cache statistics",
          error,
        );
    }
  }

  connectOwnedSignal(object, signal, callback) {
    connectOwnedSignal(this.ownedSignalConnections, object, signal, callback);
  }

  destroy() {
    if (!this.preferencesWindow) return;
    this.preferencesWindow = null;
    this.albumArtCacheViewGeneration++;

    const openDialogs = [...this.openDialogs];
    this.openDialogs.clear();
    for (const dialog of openDialogs) dialog.force_close();

    disconnectOwnedSignals(this.ownedSignalConnections);
    this.blockedAppsGroup?.destroy();
    this.albumArtCacheService.destroy();
    this.albumArtCacheService = null;
    this.clearAlbumArtCachePromise = null;
    this.settings = null;
    this.builder = null;
    this.clearAlbumArtCacheRow = null;
    this.clearAlbumArtCacheButton = null;
    this.blockedAppsGroup = null;
    this.resetGroup = null;
    this.resetSettingsRow = null;
  }
}
