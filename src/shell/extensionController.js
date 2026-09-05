/**
 * @file extensionController.js
 * @module shell.extensionController
 *
 * Composes extension lifecycle around one MediaShell media runtime inside
 * GNOME Shell.
 *
 * Settings, resources, and MediaRuntime belong to the enabled extension lifecycle.
 * Session profiles only gate user-facing Shell services and private native controls
 * adapters; locking the session must not rebuild the canonical media runtime.
 */

import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { PopupRegions } from "./ui/popup/regions.js";
import { createLogger } from "../shared/logging/logger.js";
import MediaRuntime from "./runtime/mediaRuntime.js";
import InputActionDispatcher from "./input/actionDispatcher.js";
import GlobalShortcuts from "./input/globalShortcuts.js";
import NativeControlsIntegration from "./integrations/nativeControls.js";
import ResourceRegistry from "./resources/resourceRegistry.js";
import MediaShellSettings from "./settings/settings.js";
import MediaShellIndicator from "./ui/indicator/mediaShellIndicator.js";
import { clearIconCache } from "./ui/icons.js";

const logger = createLogger("ExtensionController");

const SessionProfiles = Object.freeze({
  USER: "user",
  UNLOCK_DIALOG: "unlock-dialog",
});

function resolveSessionProfile() {
  if (Main.sessionMode.currentMode === SessionProfiles.UNLOCK_DIALOG)
    return SessionProfiles.UNLOCK_DIALOG;

  if (
    Main.sessionMode.currentMode === SessionProfiles.USER ||
    Main.sessionMode.parentMode === SessionProfiles.USER
  )
    return SessionProfiles.USER;

  return null;
}

/**
 * Coordinates the full MediaShell lifecycle inside GNOME Shell.
 */
export default class ExtensionController {
  constructor(extensionInstance) {
    this.extensionInstance = extensionInstance;
    this.extensionPath = extensionInstance.path;
    this.lifecycleGeneration = 0;
    this.sessionReconcileGeneration = 0;
    this.sessionReconcilePromise = Promise.resolve();
    this.sessionProfile = null;
    this.sessionModeSignalId = null;
    this.indicator = null;
    this.resourceRegistry = new ResourceRegistry(this.extensionPath);
    this.nativeControlsIntegration = new NativeControlsIntegration();
    this.settingsUnsubscribers = [];
  }

  async enable() {
    const lifecycleGeneration = ++this.lifecycleGeneration;

    try {
      this.resourceRegistry.register();
      this.settings = new MediaShellSettings(
        this.extensionInstance.getSettings(),
      );
      this.subscribeToSettings();
      this.sessionModeSignalId = Main.sessionMode.connect("updated", () =>
        this.handleSessionModeChanged(),
      );

      await this.scheduleSessionProfileReconcile();
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

  isCurrentSessionReconcileGeneration(sessionReconcileGeneration) {
    return (
      this.extensionInstance !== null &&
      sessionReconcileGeneration === this.sessionReconcileGeneration
    );
  }

  handleSessionModeChanged() {
    const nextProfile = resolveSessionProfile();
    if (nextProfile !== this.sessionProfile)
      this.nativeControlsIntegration?.reset();
    if (nextProfile !== SessionProfiles.USER)
      this.destroyUserSessionComponents();

    void this.scheduleSessionProfileReconcile();
  }

  scheduleSessionProfileReconcile() {
    if (!this.extensionInstance) return Promise.resolve();

    const sessionReconcileGeneration = ++this.sessionReconcileGeneration;
    this.sessionReconcilePromise = this.sessionReconcilePromise
      .catch(() => {})
      .then(async () => {
        if (
          !this.isCurrentSessionReconcileGeneration(sessionReconcileGeneration)
        )
          return;

        const profile = resolveSessionProfile();
        try {
          await this.reconcileSessionProfile(
            profile,
            sessionReconcileGeneration,
          );
        } catch (error) {
          if (
            !this.isCurrentSessionReconcileGeneration(
              sessionReconcileGeneration,
            )
          )
            return;

          this.handleSessionProfileFailure(profile, error);
        }
      });

    return this.sessionReconcilePromise;
  }

  async reconcileSessionProfile(profile, sessionReconcileGeneration) {
    if (this.sessionProfile !== profile) {
      const previousProfile = this.sessionProfile;
      this.sessionProfile = profile;
      logger.debug(
        "Session profile changed",
        previousProfile ?? "none",
        "→",
        profile ?? "none",
      );
    }

    if (profile === SessionProfiles.USER) {
      if (!this.hasMediaRuntime())
        await this.startMediaRuntime(sessionReconcileGeneration);

      if (!this.isCurrentSessionReconcileGeneration(sessionReconcileGeneration))
        return;

      this.ensureUserSessionComponents();
      this.reconcileNativeControls();
      this.reconcileIndicator();
      return;
    }

    if (profile === SessionProfiles.UNLOCK_DIALOG) {
      this.destroyUserSessionComponents();

      const needsLockScreenRuntime =
        this.settings.nativeControls.enhance &&
        NativeControlsIntegration.supportsLockScreenEnhance();
      if (needsLockScreenRuntime && !this.hasMediaRuntime())
        await this.startMediaRuntime(sessionReconcileGeneration);

      if (!this.isCurrentSessionReconcileGeneration(sessionReconcileGeneration))
        return;

      this.reconcileNativeControls();
      return;
    }

    this.nativeControlsIntegration?.reset();
    this.destroyUserSessionComponents();
    this.destroyMediaRuntime();
  }

  async startMediaRuntime(sessionReconcileGeneration) {
    if (this.mediaRuntime) this.destroyMediaRuntime();

    logger.debug("Starting media runtime");
    this.mediaRuntime = new MediaRuntime({
      mediaSettings: this.settings.media,
      callbacks: {
        onAvailablePlayersChanged: () => this.handleAvailablePlayersChanged(),
        onActivePlayerChanged: (player) =>
          this.handleActivePlayerChanged(player),
      },
    });

    // Hide does not depend on the MediaShell MPRIS runtime and can be applied
    // immediately in the user session while MPRIS discovery initializes.
    if (this.sessionProfile === SessionProfiles.USER) {
      this.ensureUserSessionComponents();
      this.reconcileNativeControls();
    }

    await this.mediaRuntime.init();
    if (!this.isCurrentSessionReconcileGeneration(sessionReconcileGeneration))
      return;

    this.reconcileNativeControls();
  }

  hasMediaRuntime() {
    return Boolean(this.mediaRuntime?.initialized);
  }

  handleSessionProfileFailure(profile, error) {
    this.nativeControlsIntegration?.reset();
    this.destroyUserSessionComponents();
    this.destroyMediaRuntime();

    if (profile === SessionProfiles.UNLOCK_DIALOG) {
      logger.warnOnce(
        "unlock-dialog-runtime-failed",
        "Failed to start native controls Enhance on the lock screen; preserving GNOME Shell native controls",
        error,
      );
      return;
    }

    if (profile === SessionProfiles.USER) {
      logger.error("Failed to start the MediaShell user runtime", error);
      this.destroy();
    }
  }

  subscribeToSettings() {
    const rebuildPanelPlacement = () => {
      if (this.sessionProfile === SessionProfiles.USER) this.rebuildIndicator();
    };
    this.settingsUnsubscribers.push(
      this.settings.panel.subscribe(
        ["position", "index"],
        rebuildPanelPlacement,
      ),
      this.settings.nativeControls.subscribe(["hide"], () => {
        if (this.sessionProfile === SessionProfiles.USER)
          this.reconcileNativeControls();
      }),
      this.settings.nativeControls.subscribe(["enhance"], () => {
        if (this.sessionProfile === SessionProfiles.UNLOCK_DIALOG)
          void this.scheduleSessionProfileReconcile();
        else if (this.sessionProfile === SessionProfiles.USER)
          this.reconcileNativeControls();
      }),
    );
  }

  unsubscribeFromSettings() {
    for (const unsubscribe of this.settingsUnsubscribers.splice(0).reverse())
      unsubscribe();
  }

  handleAvailablePlayersChanged() {
    if (this.sessionProfile === SessionProfiles.USER)
      this.indicator?.requestSurfaceUpdate({
        popup: PopupRegions.PLAYER_SELECTOR,
      });
    this.reconcileNativeControls();
  }

  reconcileNativeControls() {
    this.nativeControlsIntegration?.reconcile({
      profile: this.sessionProfile,
      hide: this.settings?.nativeControls.hide ?? false,
      enhance: this.settings?.nativeControls.enhance ?? false,
      mediaRuntime: this.mediaRuntime ?? null,
    });
  }

  ensureUserSessionComponents() {
    if (
      this.sessionProfile !== SessionProfiles.USER ||
      resolveSessionProfile() !== SessionProfiles.USER ||
      !this.mediaRuntime
    )
      return;

    if (!this.inputActionDispatcher)
      this.inputActionDispatcher = new InputActionDispatcher({
        mediaRuntime: this.mediaRuntime,
        onTogglePopup: () => this.indicator?.menu.toggle(),
        onOpenPreferences: () => this.openPreferences(),
      });

    if (!this.globalShortcuts) {
      this.globalShortcuts = new GlobalShortcuts(
        this.settings.keybindings,
        (inputAction) => this.inputActionDispatcher?.execute(inputAction),
      );
      this.globalShortcuts.enable();
    }
  }

  reconcileIndicator() {
    if (
      this.sessionProfile !== SessionProfiles.USER ||
      resolveSessionProfile() !== SessionProfiles.USER ||
      !this.inputActionDispatcher
    ) {
      this.destroyIndicator();
      return;
    }

    this.handleActivePlayerChanged(this.mediaRuntime?.activePlayer ?? null);
  }

  rebuildIndicator() {
    if (this.sessionProfile !== SessionProfiles.USER) return;

    this.destroyIndicator();
    this.reconcileIndicator();
  }

  handleActivePlayerChanged(player) {
    if (
      this.sessionProfile !== SessionProfiles.USER ||
      resolveSessionProfile() !== SessionProfiles.USER ||
      !this.inputActionDispatcher
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
    if (this.sessionProfile !== SessionProfiles.USER || !this.extensionInstance)
      return;
    this.extensionInstance.openPreferences();
  }

  destroyIndicator() {
    const indicator = this.indicator;
    this.indicator = null;
    if (!indicator) return;

    indicator.destroy();
  }

  destroyUserSessionComponents() {
    this.globalShortcuts?.destroy();
    this.globalShortcuts = null;

    this.destroyIndicator();

    this.inputActionDispatcher?.destroy();
    this.inputActionDispatcher = null;
    clearIconCache();
  }

  destroyMediaRuntime() {
    if (this.mediaRuntime) logger.debug("Stopping media runtime");
    this.mediaRuntime?.destroy();
    this.mediaRuntime = null;
  }

  destroyRuntimeComponents() {
    this.nativeControlsIntegration?.reset();
    this.destroyUserSessionComponents();
    this.destroyMediaRuntime();
  }

  destroy() {
    if (!this.extensionInstance) return;

    logger.debug("Destroying extension lifecycle");
    this.extensionInstance = null;
    this.lifecycleGeneration++;
    this.sessionReconcileGeneration++;

    if (this.sessionModeSignalId !== null) {
      Main.sessionMode.disconnect(this.sessionModeSignalId);
      this.sessionModeSignalId = null;
    }

    this.unsubscribeFromSettings();
    this.destroyRuntimeComponents();
    this.settings?.destroy();
    this.settings = null;
    this.sessionProfile = null;

    this.nativeControlsIntegration?.destroy();
    this.nativeControlsIntegration = null;

    this.resourceRegistry?.destroy();
    this.resourceRegistry = null;
  }
}
