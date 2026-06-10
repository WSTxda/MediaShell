// Owns the complete Shell-side lifecycle and coordinates settings, MPRIS, services, and UI.
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { InputActions, WidgetFlags } from "../shared/enums/MediaShellEnums.js";
import { migrateSettings, SETTINGS_SCHEMA_VERSION } from "../shared/settings/SettingsMigration.js";
import { createLogger } from "../shared/utils/log.js";
import MprisProxyFactory from "./mpris/MprisProxyFactory.js";
import MediaAppRegistry from "./mpris/MediaAppRegistry.js";
import KeyboardShortcutsController from "./services/KeyboardShortcutsController.js";
import SystemMediaControlsPatch from "./services/SystemMediaControlsPatch.js";
import { shutdownAlbumArtLoader } from "./services/AlbumArtLoader.js";
import { clearMediaAppResolverCaches } from "./services/MediaAppResolver.js";
import ExtensionResourceRegistry from "./services/ExtensionResourceRegistry.js";
import SettingsStore from "./settings/SettingsStore.js";
import { SettingsAction } from "./settings/SettingsSpec.js";
import TopBarButton from "./ui/topBar/TopBarButton.js";
import { clearIconCache } from "./ui/IconUtils.js";

const logger = createLogger("ExtensionController");

export default class ExtensionController {
    constructor(extensionInstance) {
        this.extensionInstance = extensionInstance;
        this.extensionPath = extensionInstance.path;
        this.enabled = false;
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
            if (migrateSettings(this.settings))
                logger.debug("Settings migrated to schema version", SETTINGS_SCHEMA_VERSION);
            this.settingsStore = new SettingsStore(this.settings, this, (settingKey, settingValue, settingSpec) =>
                this.handleSettingChange(settingKey, settingValue, settingSpec),
            );

            this.systemMediaControlsPatch.setSystemMediaControlsHidden(this.hideSystemMediaControls);
            this.keyboardShortcutsController = new KeyboardShortcutsController(this.settings, (inputAction) =>
                this.executeInputAction(inputAction),
            );
            this.keyboardShortcutsController.enable();

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

        this.enabled = false;
        this.lifecycleGeneration++;

        // Teardown is deliberately best-effort: one broken third-party media app
        // or Shell object must not prevent the remaining resources from being released.
        this.destroyOwnedComponent("keyboardShortcutsController");
        this.destroyTopBarButton();
        this.destroyOwnedComponent("mediaAppRegistry");
        this.destroyOwnedComponent("mprisProxyFactory");
        shutdownAlbumArtLoader();
        clearMediaAppResolverCaches();
        clearIconCache();
        this.destroyOwnedComponent("systemMediaControlsPatch");
        this.destroyOwnedComponent("settingsStore");
        this.settings = null;
        this.destroyOwnedComponent("extensionResourceRegistry");
        this.extensionInstance = null;
        logger.debug("Extension disabled");
    }
}
