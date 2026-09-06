/**
 * @file othersPageController.js
 * @module prefs.controllers.othersPageController
 *
 * Coordinates the preferences page for system integration and blocked apps.
 *
 * The controller owns rows that cannot be represented by a simple settings
 * binding, including the artwork cache actions and the blocked-app list. The
 * GNOME media-control switches remain declarative bindings; page-specific
 * maintenance and confirmation flows stay out of PreferencesController.
 */

import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";

import { SettingsKeys } from "../../shared/settings/contract.js";
import { createLogger } from "../../shared/logging/logger.js";
import { gettext as _, ngettext } from "../translations.js";
import { TOAST_TIMEOUT_SECONDS } from "../ui/presentation.js";
import { PreferencesStyleClasses } from "../ui/style.js";
import ArtworkCacheService from "../artwork/artworkCacheService.js";
import {
  connectOwnedSignal,
  disconnectOwnedSignals,
} from "../bindings/signalConnections.js";

Gio._promisify(Gtk.FileLauncher.prototype, "launch", "launch_finish");

const logger = createLogger("OthersPageController");

/**
 * Coordinates the preferences page for system integration and blocked apps.
 */
export default class OthersPageController {
  constructor(settings, builder, preferencesWindow) {
    this.settings = settings;
    this.builder = builder;
    this.preferencesWindow = preferencesWindow;
    this.artworkCacheService = new ArtworkCacheService();
    this.ownedSignalConnections = [];
    this.artworkCacheViewGeneration = 0;
    this.clearArtworkCachePromise = null;
    this.openArtworkCachePromise = null;
    this.openArtworkCacheCancellable = null;
    this.openDialogs = new Set();
  }

  init() {
    this.clearArtworkCacheRow = this.builder.get_object(
      "ar-artwork-cache-clear",
    );
    this.clearArtworkCacheButton = this.builder.get_object(
      "btn-artwork-cache-clear",
    );
    this.openArtworkCacheButton = this.builder.get_object(
      "btn-artwork-cache-open",
    );
    this.blockedAppsGroup = this.builder.get_object("gp-blocked-apps");
    this.resetGroup = this.builder.get_object("gp-reset-settings");
    this.createResetSettingsRow();

    this.blockedAppsGroup.setBlockedAppIds(
      this.settings.get_strv(SettingsKeys.MEDIA_BLOCKED_APPS),
    );
    this.connectOwnedSignal(
      this.blockedAppsGroup,
      "notify::blocked-app-ids",
      () => {
        this.settings.set_strv(
          SettingsKeys.MEDIA_BLOCKED_APPS,
          this.blockedAppsGroup.blockedAppIds,
        );
      },
    );
    this.connectOwnedSignal(this.clearArtworkCacheButton, "clicked", () =>
      this.presentClearArtworkCacheConfirmation(),
    );
    this.connectOwnedSignal(this.openArtworkCacheButton, "clicked", () =>
      this.openArtworkCacheDirectory(),
    );
    this.connectOwnedSignal(
      this.settings,
      `changed::${SettingsKeys.MEDIA_BLOCKED_APPS}`,
      () => {
        const blockedAppIds = this.settings.get_strv(
          SettingsKeys.MEDIA_BLOCKED_APPS,
        );
        if (
          JSON.stringify(blockedAppIds) !==
          JSON.stringify(this.blockedAppsGroup.blockedAppIds)
        )
          this.blockedAppsGroup.setBlockedAppIds(blockedAppIds);
      },
    );
    this.updateArtworkCacheStatsSubtitle();
  }

  createResetSettingsRow() {
    // Adw.ButtonRow requires Libadwaita 1.6 or later; MediaShell's 1.7 floor
    // (enforced by assertSupportedLibadwaita() in prefs.js) already covers it.
    this.resetSettingsRow = new Adw.ButtonRow({
      title: _("Reset All Settings"),
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
      _("Every MediaShell preference will return to its default value"),
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

  presentClearArtworkCacheConfirmation() {
    this.presentDestructiveConfirmation(
      _("Clear the cache?"),
      _("Cached content will be downloaded again when needed"),
      _("Clear Cache"),
      () => this.clearArtworkCache(),
    );
  }

  openArtworkCacheDirectory() {
    if (this.openArtworkCachePromise) return this.openArtworkCachePromise;
    if (!this.openArtworkCacheButton || !this.preferencesWindow) return null;

    const openArtworkCacheButton = this.openArtworkCacheButton;
    const cancellable = new Gio.Cancellable();
    this.openArtworkCacheCancellable = cancellable;
    openArtworkCacheButton.sensitive = false;

    const openPromise = this.performArtworkCacheOpen(cancellable).finally(
      () => {
        if (this.openArtworkCachePromise === openPromise)
          this.openArtworkCachePromise = null;
        if (this.openArtworkCacheCancellable === cancellable)
          this.openArtworkCacheCancellable = null;
        if (this.openArtworkCacheButton === openArtworkCacheButton)
          openArtworkCacheButton.sensitive = true;
      },
    );
    this.openArtworkCachePromise = openPromise;
    return openPromise;
  }

  async performArtworkCacheOpen(cancellable) {
    try {
      const launcher = Gtk.FileLauncher.new(
        this.artworkCacheService.cacheDirectory,
      );
      await launcher.launch(this.preferencesWindow, cancellable);
    } catch (error) {
      if (
        cancellable.is_cancelled() ||
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ||
        !this.preferencesWindow
      )
        return;

      logger.warn("Failed to open the artwork cache directory", error);
      this.preferencesWindow.add_toast(
        new Adw.Toast({
          title: _("Could not open the cache directory"),
          timeout: TOAST_TIMEOUT_SECONDS,
        }),
      );
    }
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

  clearArtworkCache() {
    if (this.clearArtworkCachePromise) return this.clearArtworkCachePromise;
    if (!this.clearArtworkCacheButton) return null;

    const artworkCacheViewGeneration = ++this.artworkCacheViewGeneration;
    const clearArtworkCacheButton = this.clearArtworkCacheButton;
    clearArtworkCacheButton.sensitive = false;
    const clearPromise = this.performArtworkCacheClear(
      artworkCacheViewGeneration,
    ).finally(() => {
      if (this.clearArtworkCachePromise === clearPromise)
        this.clearArtworkCachePromise = null;
      if (this.clearArtworkCacheButton === clearArtworkCacheButton)
        clearArtworkCacheButton.sensitive = true;
    });
    this.clearArtworkCachePromise = clearPromise;
    return clearPromise;
  }

  async performArtworkCacheClear(artworkCacheViewGeneration) {
    try {
      await this.artworkCacheService.clearArtworkCache();
      if (artworkCacheViewGeneration !== this.artworkCacheViewGeneration)
        return;
      this.clearArtworkCacheRow.subtitle = this.formatArtworkCacheStats(0, 0);
      this.preferencesWindow.add_toast(
        new Adw.Toast({
          title: _("Cache cleared"),
          timeout: TOAST_TIMEOUT_SECONDS,
        }),
      );
    } catch (error) {
      if (artworkCacheViewGeneration !== this.artworkCacheViewGeneration)
        return;
      logger.warn("Failed to clear the artwork cache", error);
      this.preferencesWindow.add_toast(
        new Adw.Toast({
          title: _("Could not clear the cache"),
          timeout: TOAST_TIMEOUT_SECONDS,
        }),
      );
      this.updateArtworkCacheStatsSubtitle();
    }
  }

  formatArtworkCacheStats(cachedImageCount, totalBytes) {
    const format = ngettext(
      "%d cached image — %s",
      "%d cached images — %s",
      cachedImageCount,
    );
    return format.format(cachedImageCount, GLib.format_size(totalBytes));
  }

  async updateArtworkCacheStatsSubtitle() {
    const artworkCacheViewGeneration = ++this.artworkCacheViewGeneration;
    try {
      const { cachedImageCount, totalBytes } =
        await this.artworkCacheService.readArtworkCacheStats();
      if (artworkCacheViewGeneration === this.artworkCacheViewGeneration)
        this.clearArtworkCacheRow.subtitle = this.formatArtworkCacheStats(
          cachedImageCount,
          totalBytes,
        );
    } catch (error) {
      if (artworkCacheViewGeneration === this.artworkCacheViewGeneration)
        logger.warn("Failed to calculate the artwork cache statistics", error);
    }
  }

  connectOwnedSignal(object, signal, callback) {
    connectOwnedSignal(this.ownedSignalConnections, object, signal, callback);
  }

  destroy() {
    if (!this.preferencesWindow) return;
    this.preferencesWindow = null;
    this.artworkCacheViewGeneration++;

    const openDialogs = [...this.openDialogs];
    this.openDialogs.clear();
    for (const dialog of openDialogs) dialog.force_close();

    disconnectOwnedSignals(this.ownedSignalConnections);
    this.blockedAppsGroup?.destroy();
    this.openArtworkCacheCancellable?.cancel();
    this.artworkCacheService.destroy();
    this.artworkCacheService = null;
    this.clearArtworkCachePromise = null;
    this.openArtworkCachePromise = null;
    this.openArtworkCacheCancellable = null;
    this.settings = null;
    this.builder = null;
    this.clearArtworkCacheRow = null;
    this.clearArtworkCacheButton = null;
    this.openArtworkCacheButton = null;
    this.blockedAppsGroup = null;
    this.resetGroup = null;
    this.resetSettingsRow = null;
  }
}
