/**
 * @file ExtensionController.js
 * @module shell.ExtensionController
 *
 * Coordinates the full MediaShell runtime lifecycle inside GNOME Shell.
 *
 * The controller owns settings, global shortcuts, MPRIS discovery,
 * top bar mounting, GNOME Shell media control patching, and service teardown. Async
 * work is protected by lifecycleGeneration so stale callbacks from a previous
 * enable cycle cannot mutate the current Shell state.
 */

import * as Main from "resource:///org/gnome/shell/ui/main.js";

import {
  PLAYBACK_ACTION_BY_INPUT_ACTION,
  VOLUME_STEP,
} from "../shared/constants/inputActions.js";
import { InputActions } from "../shared/enums/input.js";
import { SettingsAction } from "../shared/enums/settingsAction.js";
import { WidgetFlags } from "../shared/enums/widgetFlags.js";
import { createLogger } from "../shared/utils/log.js";
import {
  MprisOperationReasons,
  mprisOperationUnsupported,
} from "../shared/utils/mprisOperationResult.js";
import MprisProxyFactory from "./mpris/MprisProxyFactory.js";
import MediaAppRegistry from "./mpris/MediaAppRegistry.js";
import { executePlaybackControlAction } from "./mpris/playbackControlExecutor.js";
import GlobalShortcutsService from "./services/GlobalShortcutsService.js";
import GnomeShellMediaControlsPatch from "./services/GnomeShellMediaControlsPatch.js";
import AlbumArtLoader from "./services/AlbumArtLoader.js";
import DesktopAppResolver from "./services/DesktopAppResolver.js";
import ExtensionResourceRegistry from "./services/ExtensionResourceRegistry.js";
import SettingsStore from "./settings/SettingsStore.js";
import MediaShellIndicator from "./ui/indicator/MediaShellIndicator.js";
import { clearIconCache } from "./utils/icons.js";

const logger = createLogger("ExtensionController");

/**
 * Coordinates the full MediaShell runtime lifecycle inside GNOME Shell.
 */
export default class ExtensionController {
  constructor(extensionInstance) {
    this.extensionInstance = extensionInstance;
    this.extensionPath = extensionInstance.path;
    // Lifecycle generation guard:
    // `lifecycleGeneration` is incremented on every enable() and destroy() call.
    // Async callbacks capture the generation at dispatch time and compare on
    // completion. If generations differ, the extension was toggled while the
    // async operation was in flight and the stale result is discarded.
    this.lifecycleGeneration = 0;
    this.indicator = null;
    this.extensionResourceRegistry = new ExtensionResourceRegistry(
      this.extensionPath,
    );
    this.gnomeShellMediaControlsPatch = new GnomeShellMediaControlsPatch();
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

      this.gnomeShellMediaControlsPatch.setGnomeShellMediaControlsHidden(
        this.gnomeShellHideMediaControls,
      );
      this.globalShortcutsService = new GlobalShortcutsService(
        this.settings,
        (inputAction) => this.executeInputAction(inputAction),
      );
      this.globalShortcutsService.enable();

      this.mprisProxyFactory = new MprisProxyFactory();
      await this.mprisProxyFactory.init();
      if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) return;

      this.mediaAppRegistry = new MediaAppRegistry(this.mprisProxyFactory, {
        onAvailableMediaAppsChanged: () =>
          this.indicator?.requestWidgetUpdate(
            WidgetFlags.POPUP_MEDIA_APP_SELECTOR,
          ),
        onActiveMediaAppChanged: (mediaApp) =>
          this.handleActiveMediaAppChanged(mediaApp),
      });
      this.mediaAppRegistry.blockedAppIds = new Set(this.blockedAppIds);
      await this.mediaAppRegistry.init();
      if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) return;
    } catch (error) {
      logger.error("Failed to enable the extension", error);
      this.destroy();
    }
  }

  isCurrentLifecycleGeneration(lifecycleGeneration) {
    return lifecycleGeneration === this.lifecycleGeneration;
  }

  handleSettingChange(_settingKey, settingValue, settingSpec) {
    if (settingSpec.impact)
      this.indicator?.requestWidgetUpdate(settingSpec.impact);

    switch (settingSpec.action) {
      case SettingsAction.REBUILD_INDICATOR:
        this.rebuildIndicator();
        break;
      case SettingsAction.UPDATE_BLOCKED_APPS:
        this.mediaAppRegistry
          ?.setBlockedAppIds(settingValue)
          .catch((error) =>
            logger.warn("Failed to apply the blocked-app list", error),
          );
        break;
      case SettingsAction.UPDATE_GNOME_SHELL_MEDIA_CONTROLS:
        this.gnomeShellMediaControlsPatch.setGnomeShellMediaControlsHidden(
          settingValue,
        );
        break;
      default:
        break;
    }
  }

  rebuildIndicator() {
    const mediaApp = this.mediaAppRegistry?.activeMediaApp ?? null;
    this.destroyIndicator();
    if (mediaApp) this.handleActiveMediaAppChanged(mediaApp);
  }

  handleActiveMediaAppChanged(mediaApp) {
    if (!mediaApp) {
      this.destroyIndicator();
      return;
    }

    if (this.indicator) {
      this.indicator.setMediaApp(mediaApp);
      return;
    }

    this.indicator = new MediaShellIndicator(mediaApp, this);
    // Panel slot name — must match the extension's registered status area identifier.
    Main.panel.addToStatusArea(
      "MediaShell",
      this.indicator,
      this.panelIndex,
      this.panelPosition,
    );
  }

  getAvailableMediaApps() {
    return this.mediaAppRegistry?.getAvailableMediaApps() ?? [];
  }

  selectMediaApp(mediaApp) {
    return this.mediaAppRegistry?.selectMediaApp(mediaApp) ?? false;
  }

  switchMediaApp() {
    return this.mediaAppRegistry?.switchMediaApp() ?? false;
  }

  toggleMediaAppPin(mediaApp) {
    const pinStateChanged =
      this.mediaAppRegistry?.toggleMediaAppPin(mediaApp) ?? false;
    if (pinStateChanged)
      this.indicator?.requestWidgetUpdate(WidgetFlags.POPUP_MEDIA_APP_SELECTOR);
    return pinStateChanged;
  }

  togglePopup() {
    this.indicator?.menu.toggle();
  }

  executeInputAction(inputAction) {
    const mediaApp = this.mediaAppRegistry?.activeMediaApp ?? null;
    const playbackAction = PLAYBACK_ACTION_BY_INPUT_ACTION[inputAction];
    if (playbackAction)
      return executePlaybackControlAction(mediaApp, playbackAction);

    switch (inputAction) {
      case InputActions.VOLUME_UP:
        return mediaApp
          ? mediaApp.setVolume(Math.min(mediaApp.volume + VOLUME_STEP, 1))
          : mprisOperationUnsupported(MprisOperationReasons.MISSING_TARGET);
      case InputActions.VOLUME_DOWN:
        return mediaApp
          ? mediaApp.setVolume(Math.max(mediaApp.volume - VOLUME_STEP, 0))
          : mprisOperationUnsupported(MprisOperationReasons.MISSING_TARGET);
      case InputActions.TOGGLE_POPUP:
        this.togglePopup();
        break;
      case InputActions.OPEN_PREFERENCES:
        this.openPreferences();
        break;
      case InputActions.RAISE_APP:
        return (
          mediaApp?.raise() ??
          mprisOperationUnsupported(MprisOperationReasons.MISSING_TARGET)
        );
      case InputActions.QUIT_APP:
        return (
          mediaApp?.quit() ??
          mprisOperationUnsupported(MprisOperationReasons.MISSING_TARGET)
        );
      case InputActions.SWITCH_APP:
        this.switchMediaApp();
        break;
      default:
        break;
    }
  }

  openPreferences() {
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

  destroy() {
    if (!this.extensionResourceRegistry) return;

    this.lifecycleGeneration++;

    this.destroyOwnedComponent("globalShortcutsService");
    this.destroyOwnedComponent("settingsStore");
    this.destroyIndicator();
    this.destroyOwnedComponent("mediaAppRegistry");
    this.destroyOwnedComponent("mprisProxyFactory");
    AlbumArtLoader.destroyInstance();
    DesktopAppResolver.getInstance().clearCaches();
    clearIconCache();
    this.destroyOwnedComponent("gnomeShellMediaControlsPatch");
    this.settings = null;
    this.destroyOwnedComponent("extensionResourceRegistry");
    this.extensionInstance = null;
  }
}
