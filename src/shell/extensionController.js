/**
 * @file extensionController.js
 * @module shell.extensionController
 *
 * Composes extension lifecycle around the MediaShell runtime inside GNOME Shell.
 *
 * Settings and resources live for the extension lifecycle. Runtime profiles keep
 * the user session separate from the optional lock-screen enhancement, while
 * generation guards reject stale asynchronous startup.
 */

import * as Main from "resource:///org/gnome/shell/ui/main.js";

import {
  PLAYBACK_ACTION_BY_INPUT_ACTION,
  VOLUME_STEP,
} from "../shared/input/actions.js";
import { InputActions } from "../shared/input/types.js";
import { WidgetFlags } from "./ui/widgetFlags.js";
import { createLogger } from "../shared/logging/logger.js";
import MediaRuntime from "./runtime/mediaRuntime.js";
import GlobalShortcutsService from "./services/globalShortcutsService.js";
import GnomeShellEnhanceMediaControls from "./services/gnomeShellEnhanceMediaControls.js";
import GnomeShellHideMediaControls from "./services/gnomeShellHideMediaControls.js";
import AlbumArtLoader from "./services/albumArtLoader.js";
import ExtensionResourceRegistry from "./services/extensionResourceRegistry.js";
import { SettingsAction } from "./settings/settingsSpec.js";
import SettingsStore from "./settings/settingsStore.js";
import MediaShellIndicator from "./ui/indicator/mediaShellIndicator.js";
import { clearIconCache } from "./utils/icons.js";

const logger = createLogger("ExtensionController");

const RuntimeProfiles = Object.freeze({
  USER: "user",
  UNLOCK_DIALOG: "unlock-dialog",
});

function resolveRuntimeProfile() {
  if (Main.sessionMode.currentMode === RuntimeProfiles.UNLOCK_DIALOG)
    return RuntimeProfiles.UNLOCK_DIALOG;

  if (
    Main.sessionMode.currentMode === RuntimeProfiles.USER ||
    Main.sessionMode.parentMode === RuntimeProfiles.USER
  )
    return RuntimeProfiles.USER;

  return null;
}

/**
 * Coordinates the full MediaShell runtime lifecycle inside GNOME Shell.
 */
export default class ExtensionController {
  constructor(extensionInstance) {
    this.extensionInstance = extensionInstance;
    this.extensionPath = extensionInstance.path;
    this.lifecycleGeneration = 0;
    this.runtimeReconcileGeneration = 0;
    this.runtimeReconcilePromise = Promise.resolve();
    this.runtimeProfile = null;
    this.sessionModeSignalId = null;
    this.indicator = null;
    this.extensionResourceRegistry = new ExtensionResourceRegistry(
      this.extensionPath,
    );
    this.gnomeShellHideMediaControlsService = null;
    this.gnomeShellEnhanceMediaControlsService = null;
  }

  async enable() {
    const lifecycleGeneration = ++this.lifecycleGeneration;

    try {
      this.extensionResourceRegistry.register();
      this.settings = this.extensionInstance.getSettings();
      this.settingsStore = new SettingsStore(
        this.settings,
        this,
        (settingKey, settingValue, settingSpec) =>
          this.handleSettingChange(settingKey, settingValue, settingSpec),
      );
      this.sessionModeSignalId = Main.sessionMode.connect("updated", () =>
        this.handleSessionModeChanged(),
      );

      await this.scheduleRuntimeProfileReconcile();
      if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) return;
    } catch (error) {
      logger.error("Failed to enable the extension", error);
      this.destroy();
    }
  }

  isCurrentLifecycleGeneration(lifecycleGeneration) {
    return (
      this.extensionInstance !== null &&
      lifecycleGeneration === this.lifecycleGeneration
    );
  }

  isCurrentRuntimeReconcileGeneration(runtimeReconcileGeneration) {
    return (
      this.extensionInstance !== null &&
      runtimeReconcileGeneration === this.runtimeReconcileGeneration
    );
  }

  handleSessionModeChanged() {
    if (resolveRuntimeProfile() !== RuntimeProfiles.USER)
      this.destroyIndicator();

    void this.scheduleRuntimeProfileReconcile();
  }

  scheduleRuntimeProfileReconcile() {
    if (!this.extensionInstance) return Promise.resolve();

    const runtimeReconcileGeneration = ++this.runtimeReconcileGeneration;
    this.runtimeReconcilePromise = this.runtimeReconcilePromise
      .catch(() => {})
      .then(async () => {
        if (
          !this.isCurrentRuntimeReconcileGeneration(runtimeReconcileGeneration)
        )
          return;

        const profile = resolveRuntimeProfile();
        try {
          await this.reconcileRuntimeProfile(
            profile,
            runtimeReconcileGeneration,
          );
        } catch (error) {
          if (
            !this.isCurrentRuntimeReconcileGeneration(
              runtimeReconcileGeneration,
            )
          )
            return;

          this.handleRuntimeProfileFailure(profile, error);
        }
      });

    return this.runtimeReconcilePromise;
  }

  async reconcileRuntimeProfile(profile, runtimeReconcileGeneration) {
    if (this.runtimeProfile !== profile) {
      this.destroyRuntimeComponents();
      this.runtimeProfile = profile;
    }

    if (profile === RuntimeProfiles.USER) {
      if (!this.hasMediaRuntime()) {
        if (this.hasRuntimeComponents()) this.destroyRuntimeComponents();
        await this.startMediaRuntime(runtimeReconcileGeneration, {
          includeUserServices: true,
        });
      } else this.reconcileGnomeShellMediaControls();
      return;
    }

    if (profile === RuntimeProfiles.UNLOCK_DIALOG) {
      if (
        !this.gnomeShellEnhanceMediaControls ||
        !GnomeShellEnhanceMediaControls.supportsLockScreen()
      ) {
        this.destroyRuntimeComponents();
        return;
      }

      if (!this.hasMediaRuntime()) {
        if (this.hasRuntimeComponents()) this.destroyRuntimeComponents();
        await this.startMediaRuntime(runtimeReconcileGeneration, {
          includeUserServices: false,
        });
      } else this.reconcileGnomeShellMediaControls();
      return;
    }

    this.destroyRuntimeComponents();
  }

  async startMediaRuntime(runtimeReconcileGeneration, { includeUserServices }) {
    // Artwork remains a separate owned service until the dedicated artwork
    // refactor. Protocol, playback, and desktop identity now live together in
    // MediaRuntime so every consumer sees one coherent media capability graph.
    this.albumArtLoader = new AlbumArtLoader();
    this.mediaRuntime = new MediaRuntime({
      blockedAppIds: this.blockedAppIds,
      callbacks: {
        onAvailablePlayersChanged: () => this.handleAvailablePlayersChanged(),
        onActivePlayerChanged: (player) => this.handleActivePlayerChanged(player),
      },
    });

    if (includeUserServices) {
      // Hide can be applied before the MediaShell MPRIS runtime exists.
      this.reconcileGnomeShellMediaControls();
      this.globalShortcutsService = new GlobalShortcutsService(
        this.settings,
        (inputAction) => this.executeInputAction(inputAction),
      );
      this.globalShortcutsService.enable();
    }

    await this.mediaRuntime.init();
    if (!this.isCurrentRuntimeReconcileGeneration(runtimeReconcileGeneration))
      return;

    this.reconcileGnomeShellMediaControls();
  }

  hasMediaRuntime() {
    return Boolean(this.mediaRuntime?.initialized);
  }

  hasRuntimeComponents() {
    return Boolean(
      this.globalShortcutsService ||
      this.gnomeShellEnhanceMediaControlsService ||
      this.gnomeShellHideMediaControlsService ||
      this.indicator ||
      this.mediaRuntime ||
      this.albumArtLoader,
    );
  }

  handleRuntimeProfileFailure(profile, error) {
    this.destroyRuntimeComponents();

    if (profile === RuntimeProfiles.UNLOCK_DIALOG) {
      logger.warnOnce(
        "unlock-dialog-runtime-failed",
        "Failed to start the lock-screen media enhancement; preserving GNOME Shell native controls",
        error,
      );
      return;
    }

    if (profile === RuntimeProfiles.USER) {
      logger.error("Failed to start the MediaShell user runtime", error);
      this.destroy();
    }
  }

  handleSettingChange(_settingKey, settingValue, settingSpec) {
    if (settingSpec.impact)
      this.indicator?.requestWidgetUpdate(settingSpec.impact);

    switch (settingSpec.action) {
      case SettingsAction.REBUILD_INDICATOR:
        if (this.runtimeProfile === RuntimeProfiles.USER)
          this.rebuildIndicator();
        break;
      case SettingsAction.UPDATE_BLOCKED_APPS:
        this.mediaRuntime
          ?.setBlockedAppIds(settingValue)
          .catch((error) =>
            logger.warn("Failed to apply the blocked-app list", error),
          );
        break;
      case SettingsAction.UPDATE_GNOME_SHELL_HIDE_MEDIA_CONTROLS:
        if (this.runtimeProfile === RuntimeProfiles.USER)
          this.reconcileGnomeShellMediaControls();
        break;
      case SettingsAction.UPDATE_GNOME_SHELL_ENHANCE_MEDIA_CONTROLS:
        if (this.runtimeProfile === RuntimeProfiles.UNLOCK_DIALOG)
          void this.scheduleRuntimeProfileReconcile();
        else this.reconcileGnomeShellMediaControls();
        break;
      default:
        break;
    }
  }

  handleAvailablePlayersChanged() {
    if (this.runtimeProfile === RuntimeProfiles.USER)
      this.indicator?.requestWidgetUpdate(WidgetFlags.POPUP_MEDIA_APP_SELECTOR);
    this.gnomeShellEnhanceMediaControlsService?.reconcile();
  }

  getEnhanceMediaControlsOptions() {
    return {
      albumArtLoader: this.albumArtLoader,
      playbackController: this.mediaRuntime?.playback ?? null,
      getAvailableMediaApps: () => this.mediaRuntime?.getAvailablePlayers() ?? [],
      getAlbumArtCacheEnabled: () => this.albumArtCacheEnabled,
    };
  }

  reconcileGnomeShellMediaControls() {
    if (this.runtimeProfile === RuntimeProfiles.USER) {
      if (this.gnomeShellHideMediaControls) {
        this.destroyOwnedComponent("gnomeShellEnhanceMediaControlsService");
        if (!this.gnomeShellHideMediaControlsService)
          this.gnomeShellHideMediaControlsService =
            new GnomeShellHideMediaControls();
        this.gnomeShellHideMediaControlsService.reconcile();
        return;
      }

      this.destroyOwnedComponent("gnomeShellHideMediaControlsService");
      if (!this.gnomeShellEnhanceMediaControls || !this.hasMediaRuntime()) {
        this.destroyOwnedComponent("gnomeShellEnhanceMediaControlsService");
        return;
      }

      if (!this.gnomeShellEnhanceMediaControlsService)
        this.gnomeShellEnhanceMediaControlsService =
          GnomeShellEnhanceMediaControls.createNotificationList(
            this.getEnhanceMediaControlsOptions(),
          );
      this.gnomeShellEnhanceMediaControlsService.reconcile();
      return;
    }

    this.destroyOwnedComponent("gnomeShellHideMediaControlsService");
    if (
      this.runtimeProfile !== RuntimeProfiles.UNLOCK_DIALOG ||
      !this.gnomeShellEnhanceMediaControls ||
      !this.hasMediaRuntime()
    ) {
      this.destroyOwnedComponent("gnomeShellEnhanceMediaControlsService");
      return;
    }

    if (!this.gnomeShellEnhanceMediaControlsService)
      this.gnomeShellEnhanceMediaControlsService =
        GnomeShellEnhanceMediaControls.createLockScreen(
          this.getEnhanceMediaControlsOptions(),
        );
    this.gnomeShellEnhanceMediaControlsService.reconcile();
  }

  rebuildIndicator() {
    if (this.runtimeProfile !== RuntimeProfiles.USER) return;

    const mediaApp = this.mediaRuntime?.activePlayer ?? null;
    this.destroyIndicator();
    if (mediaApp) this.handleActivePlayerChanged(mediaApp);
  }

  handleActivePlayerChanged(mediaApp) {
    if (
      this.runtimeProfile !== RuntimeProfiles.USER ||
      resolveRuntimeProfile() !== RuntimeProfiles.USER
    ) {
      this.destroyIndicator();
      return;
    }

    if (!mediaApp) {
      this.destroyIndicator();
      return;
    }

    if (this.indicator) {
      this.indicator.setMediaApp(mediaApp);
      return;
    }

    this.indicator = new MediaShellIndicator(mediaApp, this, {
      albumArtLoader: this.albumArtLoader,
      mediaRuntime: this.mediaRuntime,
    });
    // Panel slot name — must match the extension's registered status area identifier.
    Main.panel.addToStatusArea(
      "MediaShell",
      this.indicator,
      this.panelIndex,
      this.panelPosition,
    );
  }

  togglePopup() {
    this.indicator?.menu.toggle();
  }

  executeInputAction(inputAction) {
    if (this.runtimeProfile !== RuntimeProfiles.USER) return;

    const playbackAction = PLAYBACK_ACTION_BY_INPUT_ACTION[inputAction];
    if (playbackAction) return this.mediaRuntime?.playback.execute(playbackAction);

    switch (inputAction) {
      case InputActions.VOLUME_UP:
        return this.mediaRuntime?.playback.increaseVolume(VOLUME_STEP);
      case InputActions.VOLUME_DOWN:
        return this.mediaRuntime?.playback.decreaseVolume(VOLUME_STEP);
      case InputActions.TOGGLE_POPUP:
        this.togglePopup();
        break;
      case InputActions.OPEN_PREFERENCES:
        this.openPreferences();
        break;
      case InputActions.RAISE_APP:
        return this.mediaRuntime?.playback.raise();
      case InputActions.QUIT_APP:
        return this.mediaRuntime?.playback.quit();
      case InputActions.SWITCH_APP:
        this.mediaRuntime?.switchPlayer();
        break;
      default:
        break;
    }
  }

  openPreferences() {
    if (this.runtimeProfile !== RuntimeProfiles.USER || !this.extensionInstance)
      return;
    this.extensionInstance.openPreferences();
  }

  destroyIndicator() {
    const indicator = this.indicator;
    this.indicator = null;
    if (!indicator) return;

    indicator.destroy();
  }

  destroyOwnedComponent(propertyName) {
    const ownedComponent = this[propertyName];
    this[propertyName] = null;
    if (!ownedComponent) return;

    ownedComponent.destroy();
  }

  destroyRuntimeComponents() {
    this.destroyOwnedComponent("globalShortcutsService");
    this.destroyOwnedComponent("gnomeShellEnhanceMediaControlsService");
    this.destroyOwnedComponent("gnomeShellHideMediaControlsService");
    this.destroyIndicator();
    this.destroyOwnedComponent("mediaRuntime");
    this.destroyOwnedComponent("albumArtLoader");
    clearIconCache();
  }

  destroy() {
    if (!this.extensionInstance) return;

    this.extensionInstance = null;
    this.lifecycleGeneration++;
    this.runtimeReconcileGeneration++;

    if (this.sessionModeSignalId !== null) {
      Main.sessionMode.disconnect(this.sessionModeSignalId);
      this.sessionModeSignalId = null;
    }

    this.destroyOwnedComponent("settingsStore");
    this.destroyRuntimeComponents();
    this.settings = null;
    this.runtimeProfile = null;
    this.destroyOwnedComponent("extensionResourceRegistry");
  }
}
