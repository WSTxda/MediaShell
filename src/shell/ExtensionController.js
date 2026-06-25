/**
 * @file ExtensionController.js
 * @module shell.ExtensionController
 *
 * Coordinates the full MediaShell runtime lifecycle inside GNOME Shell.
 *
 * The controller owns settings, migrations, global shortcuts, MPRIS discovery,
 * top-bar mounting, system media control patching, and service teardown. Async
 * work is protected by lifecycleGeneration so stale callbacks from a previous
 * enable cycle cannot mutate the current Shell state.
 */
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { InputActions } from "../shared/enums/input.js";
import { SettingsAction } from "../shared/enums/settings.js";
import { WidgetFlags } from "../shared/enums/widget.js";
import { migrateSettings, SETTINGS_SCHEMA_VERSION } from "../shared/settings/SettingsMigration.js";
import { createLogger } from "../shared/utils/log.js";
import MprisProxyFactory from "./mpris/MprisProxyFactory.js";
import MediaAppRegistry from "./mpris/MediaAppRegistry.js";
import GlobalShortcutsService from "./services/GlobalShortcutsService.js";
import SystemMediaControlsPatch from "./services/SystemMediaControlsPatch.js";
import AlbumArtLoader from "./services/AlbumArtLoader.js";
import MediaAppResolver from "./services/MediaAppResolver.js";
import ExtensionResourceRegistry from "./services/ExtensionResourceRegistry.js";
import SettingsStore from "./settings/SettingsStore.js";
import TopBarButton from "./ui/topBar/TopBarButton.js";
import { clearIconCache } from "./ui/IconUtils.js";

const logger = createLogger("ExtensionController");

export default class ExtensionController {
    constructor(extensionInstance) {
        this.extensionInstance = extensionInstance;
        this.extensionPath = extensionInstance.path;
        this.enabled = false;
        // DEVELOPER NOTE — Lifecycle generation guard:
        // `lifecycleGeneration` is incremented on every enable() and destroy() call.
        // Async callbacks capture the generation at dispatch time and compare on
        // completion. If generations differ, the extension was toggled while the
        // async operation was in flight and the stale result is discarded.
        this.lifecycleGeneration = 0;
        this.topBarButton = null;
        this.extensionResourceRegistry = new ExtensionResourceRegistry(this.extensionPath);
        this.systemMediaControlsPatch = new SystemMediaControlsPatch();
    }

    async enable() {
        if (this.enabled) return;

        this.enabled = true;
        const lifecycleGeneration = ++this.lifecycleGeneration;
        logger.debug("Starting extension services");

        try {
            this.extensionResourceRegistry.register();
            this.settings = this.extensionInstance.getSettings();
            const settingsWereMigrated = migrateSettings(this.settings);
            logger.debug("Settings schema version", SETTINGS_SCHEMA_VERSION, "migrated", settingsWereMigrated);
            this.settingsStore = new SettingsStore(this.settings, this, (settingKey, settingValue, settingSpec) =>
                this.handleSettingChange(settingKey, settingValue, settingSpec),
            );

            this.systemMediaControlsPatch.setSystemMediaControlsHidden(this.hideSystemMediaControls);
            this.globalShortcutsService = new GlobalShortcutsService(this.settings, (inputAction) =>
                this.executeInputAction(inputAction),
            );
            this.globalShortcutsService.enable();

            this.mprisProxyFactory = new MprisProxyFactory();
            await this.mprisProxyFactory.init();
            if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) return;

            this.mediaAppRegistry = new MediaAppRegistry(this.mprisProxyFactory, {
                onMediaAppsChanged: () => this.topBarButton?.requestWidgetUpdate(WidgetFlags.POPUP_APP_SELECTOR),
                onActiveMediaAppChanged: (mediaApp) => this.setActiveMediaApp(mediaApp),
            });
            this.mediaAppRegistry.blockedAppIds = new Set(this.blockedAppIds);
            await this.mediaAppRegistry.init();
            if (!this.isCurrentLifecycleGeneration(lifecycleGeneration)) return;

            logger.debug("Extension enabled");
        } catch (error) {
            logger.error("Failed to enable the extension", error);
            this.destroy();
        }
    }

    isCurrentLifecycleGeneration(lifecycleGeneration) {
        return this.enabled && lifecycleGeneration === this.lifecycleGeneration;
    }

    handleSettingChange(_settingKey, settingValue, settingSpec) {
        if (!this.enabled) return;

        if (settingSpec.impact) this.topBarButton?.requestWidgetUpdate(settingSpec.impact);

        switch (settingSpec.action) {
            case SettingsAction.REBUILD_TOP_BAR_BUTTON:
                this.rebuildTopBarButton();
                break;
            case SettingsAction.UPDATE_BLOCKED_APPS:
                this.mediaAppRegistry
                    ?.setBlockedAppIds(settingValue)
                    .catch((error) => logger.warn("Failed to apply the blocked-app list", error));
                break;
            case SettingsAction.UPDATE_SYSTEM_MEDIA_CONTROLS:
                this.systemMediaControlsPatch.setSystemMediaControlsHidden(settingValue);
                break;
            default:
                break;
        }
    }

    rebuildTopBarButton() {
        const mediaApp = this.mediaAppRegistry?.activeMediaApp ?? null;
        this.destroyTopBarButton();
        if (mediaApp) this.setActiveMediaApp(mediaApp);
    }

    setActiveMediaApp(mediaApp) {
        if (!this.enabled) return;

        if (!mediaApp) {
            this.destroyTopBarButton();
            return;
        }

        if (this.topBarButton) {
            this.topBarButton.setMediaApp(mediaApp);
            return;
        }

        this.topBarButton = new TopBarButton(mediaApp, this);
        // Panel slot name — must match the extension's registered status area identifier.
        Main.panel.addToStatusArea("MediaShell", this.topBarButton, this.topBarIndex, this.topBarPosition);
        logger.debug("Created top bar button for", mediaApp.busName);
    }

    getMediaApps() {
        return this.mediaAppRegistry?.getMediaApps() ?? [];
    }

    selectMediaApp(mediaApp) {
        return this.mediaAppRegistry?.activateMediaApp(mediaApp) ?? false;
    }

    activateNextMediaApp() {
        return this.mediaAppRegistry?.activateNextMediaApp() ?? false;
    }

    toggleMediaAppPin(mediaApp) {
        const pinStateChanged = this.mediaAppRegistry?.toggleMediaAppPin(mediaApp) ?? false;
        if (pinStateChanged) this.topBarButton?.requestWidgetUpdate(WidgetFlags.POPUP_APP_SELECTOR);
        return pinStateChanged;
    }

    togglePopup() {
        this.topBarButton?.menu.toggle();
    }

    executeInputAction(inputAction) {
        const mediaApp = this.mediaAppRegistry?.activeMediaApp ?? null;

        switch (inputAction) {
            case InputActions.PLAY_PAUSE:
                mediaApp?.playPause();
                break;
            case InputActions.NEXT_TRACK:
                mediaApp?.next();
                break;
            case InputActions.PREVIOUS_TRACK:
                mediaApp?.previous();
                break;
            case InputActions.VOLUME_UP:
                if (mediaApp) mediaApp.volume = Math.min(mediaApp.volume + 0.05, 1);
                break;
            case InputActions.VOLUME_DOWN:
                if (mediaApp) mediaApp.volume = Math.max(mediaApp.volume - 0.05, 0);
                break;
            case InputActions.TOGGLE_LOOP:
                mediaApp?.toggleLoop();
                break;
            case InputActions.TOGGLE_SHUFFLE:
                mediaApp?.toggleShuffle();
                break;
            case InputActions.TOGGLE_POPUP:
                this.togglePopup();
                break;
            case InputActions.RAISE_APP:
                mediaApp?.raise();
                break;
            case InputActions.QUIT_APP:
                mediaApp?.quit();
                break;
            case InputActions.OPEN_PREFERENCES:
                this.openPreferences();
                break;
            case InputActions.NEXT_APP:
                this.activateNextMediaApp();
                break;
            default:
                break;
        }
    }

    openPreferences() {
        this.extensionInstance.openPreferences();
    }

    destroyTopBarButton() {
        const topBarButton = this.topBarButton;
        this.topBarButton = null;
        if (!topBarButton) return;

        try {
            logger.debug("Destroying top bar button for", topBarButton.mediaApp?.busName ?? "unknown");
            topBarButton.destroy();
        } catch (error) {
            logger.error("Failed to destroy the top bar button cleanly", error);
        }
    }

    destroyOwnedComponent(propertyName) {
        const ownedComponent = this[propertyName];
        this[propertyName] = null;
        if (!ownedComponent) return;

        try {
            ownedComponent.destroy();
        } catch (error) {
            logger.error(`Failed to destroy ${propertyName}`, error);
        }
    }

    destroy() {
        if (!this.enabled && !this.extensionResourceRegistry) return;

        logger.debug("Extension disable started");
        this.enabled = false;
        this.lifecycleGeneration++;

        // Teardown is deliberately best-effort: one broken third-party media app
        // or Shell object must not prevent the remaining resources from being released.
        this.destroyOwnedComponent("globalShortcutsService");
        this.destroyTopBarButton();
        this.destroyOwnedComponent("mediaAppRegistry");
        this.destroyOwnedComponent("mprisProxyFactory");
        AlbumArtLoader.getInstance().destroy();
        MediaAppResolver.getInstance().clearCaches();
        clearIconCache();
        this.destroyOwnedComponent("systemMediaControlsPatch");
        this.destroyOwnedComponent("settingsStore");
        this.settings = null;
        this.destroyOwnedComponent("extensionResourceRegistry");
        this.extensionInstance = null;
        logger.debug("Extension disable finished");
    }
}
