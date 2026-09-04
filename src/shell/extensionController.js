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

import { PopupRegions } from "./ui/popup/regions.js";
import { NativeMediaControlsModes } from "../shared/settings/contract.js";
import { createLogger } from "../shared/logging/logger.js";
import MediaRuntime from "./runtime/mediaRuntime.js";
import InputActionDispatcher from "./input/actionDispatcher.js";
import GlobalShortcuts from "./input/globalShortcuts.js";
import NativeMediaControlsIntegration from "./integrations/nativeMediaControls.js";
import ResourceRegistry from "./resources/resourceRegistry.js";
import MediaShellSettings from "./settings/settings.js";
import MediaShellIndicator from "./ui/indicator/mediaShellIndicator.js";
import { clearIconCache } from "./ui/icons.js";

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
    this.resourceRegistry = new ResourceRegistry(this.extensionPath);
    this.nativeMediaControlsIntegration = new NativeMediaControlsIntegration();
    this.settingsSubscriptions = [];
  }

  async enable() {
    const lifecycleGeneration = ++this.lifecycleGeneration;

    try {
      this.resourceRegistry.register();
      this.settings = new MediaShellSettings(
        this.extensionInstance.getSettings(),
      );
      this.installSettingsSubscriptions();
      this.sessionModeSignalId = Main.sessionMode.connect("updated", () =>
        this.handleSessionModeChanged(),
      );

      await this.scheduleRuntimeProfileReconcile();
      if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) return;
      logger.debug("Extension lifecycle enabled");
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
      const previousProfile = this.runtimeProfile;
      this.destroyRuntimeComponents();
      this.runtimeProfile = profile;
      logger.debug(
        "Runtime profile changed",
        previousProfile ?? "none",
        "→",
        profile ?? "none",
      );
    }

    if (profile === RuntimeProfiles.USER) {
      if (!this.hasMediaRuntime()) {
        if (this.hasRuntimeComponents()) this.destroyRuntimeComponents();
        await this.startMediaRuntime(runtimeReconcileGeneration, {
          includeUserServices: true,
        });
      } else this.reconcileNativeMediaControls();
      return;
    }

    if (profile === RuntimeProfiles.UNLOCK_DIALOG) {
      if (
        this.settings.integration.nativeMediaControlsMode !==
          NativeMediaControlsModes.ENHANCED ||
        !NativeMediaControlsIntegration.supportsLockScreen()
      ) {
        this.destroyRuntimeComponents();
        return;
      }

      if (!this.hasMediaRuntime()) {
        if (this.hasRuntimeComponents()) this.destroyRuntimeComponents();
        await this.startMediaRuntime(runtimeReconcileGeneration, {
          includeUserServices: false,
        });
      } else this.reconcileNativeMediaControls();
      return;
    }

    this.destroyRuntimeComponents();
  }

  async startMediaRuntime(runtimeReconcileGeneration, { includeUserServices }) {
    logger.debug(
      "Starting media runtime",
      includeUserServices ? "user services enabled" : "minimal profile",
    );
    this.mediaRuntime = new MediaRuntime({
      mediaSettings: this.settings.media,
      callbacks: {
        onAvailablePlayersChanged: () => this.handleAvailablePlayersChanged(),
        onActivePlayerChanged: (player) =>
          this.handleActivePlayerChanged(player),
      },
    });

    if (includeUserServices) {
      this.inputActionDispatcher = new InputActionDispatcher({
        mediaRuntime: this.mediaRuntime,
        onTogglePopup: () => this.indicator?.menu.toggle(),
        onOpenPreferences: () => this.openPreferences(),
      });

      // Hide can be applied before the MediaShell MPRIS runtime exists.
      this.reconcileNativeMediaControls();
      this.globalShortcuts = new GlobalShortcuts(
        this.settings.keybindings,
        (inputAction) => this.inputActionDispatcher?.execute(inputAction),
      );
      this.globalShortcuts.enable();
    }

    await this.mediaRuntime.init();
    if (!this.isCurrentRuntimeReconcileGeneration(runtimeReconcileGeneration))
      return;

    this.reconcileNativeMediaControls();
  }

  hasMediaRuntime() {
    return Boolean(this.mediaRuntime?.initialized);
  }

  hasRuntimeComponents() {
    return Boolean(
      this.globalShortcuts ||
      this.inputActionDispatcher ||
      this.indicator ||
      this.mediaRuntime,
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

  installSettingsSubscriptions() {
    const rebuildPanelPlacement = () => {
      if (this.runtimeProfile === RuntimeProfiles.USER) this.rebuildIndicator();
    };
    this.settingsSubscriptions.push(
      this.settings.panel.subscribe(
        ["position", "index"],
        rebuildPanelPlacement,
      ),
      this.settings.integration.subscribe("nativeMediaControlsMode", () => {
        if (this.runtimeProfile === RuntimeProfiles.UNLOCK_DIALOG)
          void this.scheduleRuntimeProfileReconcile();
        else if (this.runtimeProfile === RuntimeProfiles.USER)
          this.reconcileNativeMediaControls();
      }),
    );
  }

  clearSettingsSubscriptions() {
    for (const unsubscribe of this.settingsSubscriptions.splice(0).reverse())
      unsubscribe();
  }

  handleAvailablePlayersChanged() {
    if (this.runtimeProfile === RuntimeProfiles.USER)
      this.indicator?.requestSurfaceUpdate({
        popup: PopupRegions.PLAYER_SELECTOR,
      });
    this.reconcileNativeMediaControls();
  }

  reconcileNativeMediaControls() {
    this.nativeMediaControlsIntegration?.reconcile({
      profile: this.runtimeProfile,
      mode: this.settings?.integration.nativeMediaControlsMode ?? null,
      mediaRuntime: this.mediaRuntime ?? null,
    });
  }

  rebuildIndicator() {
    if (this.runtimeProfile !== RuntimeProfiles.USER) return;

    const player = this.mediaRuntime?.activePlayer ?? null;
    this.destroyIndicator();
    if (player) this.handleActivePlayerChanged(player);
  }

  handleActivePlayerChanged(player) {
    if (
      this.runtimeProfile !== RuntimeProfiles.USER ||
      resolveRuntimeProfile() !== RuntimeProfiles.USER
    ) {
      this.destroyIndicator();
      return;
    }

    if (!player) {
      this.destroyIndicator();
      return;
    }

    if (this.indicator) {
      this.indicator.setPlayer(player);
      return;
    }

    this.indicator = new MediaShellIndicator(player, {
      mediaRuntime: this.mediaRuntime,
      settings: this.settings,
      inputActions: this.inputActionDispatcher,
    });
    // Panel slot name — must match the extension's registered status area identifier.
    Main.panel.addToStatusArea(
      "MediaShell",
      this.indicator,
      this.settings.panel.index,
      this.settings.panel.position,
    );
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

  destroyRuntimeComponents() {
    this.globalShortcuts?.destroy();
    this.globalShortcuts = null;

    this.nativeMediaControlsIntegration?.reset();
    this.destroyIndicator();

    this.inputActionDispatcher?.destroy();
    this.inputActionDispatcher = null;

    if (this.mediaRuntime) logger.debug("Stopping media runtime");
    this.mediaRuntime?.destroy();
    this.mediaRuntime = null;
    clearIconCache();
  }

  destroy() {
    if (!this.extensionInstance) return;

    logger.debug("Destroying extension lifecycle");
    this.extensionInstance = null;
    this.lifecycleGeneration++;
    this.runtimeReconcileGeneration++;

    if (this.sessionModeSignalId !== null) {
      Main.sessionMode.disconnect(this.sessionModeSignalId);
      this.sessionModeSignalId = null;
    }

    this.clearSettingsSubscriptions();
    this.destroyRuntimeComponents();
    this.settings?.destroy();
    this.settings = null;
    this.runtimeProfile = null;

    this.nativeMediaControlsIntegration?.destroy();
    this.nativeMediaControlsIntegration = null;

    this.resourceRegistry?.destroy();
    this.resourceRegistry = null;
  }
}
