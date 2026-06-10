// Provides defensive app metadata access and themed icon fallbacks for preferences.
import Gio from "gi://Gio";

import { IconNames } from "../../shared/constants/icons.js";
import { createLogger } from "../../shared/utils/log.js";

const logger = createLogger("InstalledAppCatalog");
const FALLBACK_NAMES = Object.freeze([IconNames.APP, IconNames.MISSING]);
const FALLBACK_APP_ICON = Gio.ThemedIcon.new_from_names(FALLBACK_NAMES);

export function getAppId(app) {
    try {
        return app?.get_id?.() || "";
    } catch (error) {
        logger.debugOnce("app-id", "App ID metadata was unavailable", error);
        return "";
    }
}

export function getAppName(app, fallback = "") {
    try {
        return app?.get_display_name?.() || app?.get_name?.() || getAppId(app) || fallback;
    } catch (error) {
        logger.debugOnce("app-name", "App name metadata was unavailable", error);
        return fallback;
    }
}

export function getAppIcon(app) {
    try {
        // Keep the original Gio.Icon object. Rebuilding a Gio.ThemedIcon from
        // its names can discard implementation details used by GTK to resolve
        // desktop-file icons and caused every chooser row to hit the fallback.
        return app?.get_icon?.() ?? FALLBACK_APP_ICON;
    } catch (error) {
        logger.debugOnce("app-icon", "App icon metadata was unavailable; using the fallback", error);
        return FALLBACK_APP_ICON;
    }
}

export function listInstalledApps() {
    try {
        const appsById = new Map();
        for (const app of Gio.AppInfo.get_all()) {
            const appId = getAppId(app);
            if (!appId || appsById.has(appId)) continue;
            appsById.set(appId, app);
        }
        return [...appsById.values()];
    } catch (error) {
        logger.warn("Installed apps could not be enumerated", error);
        return [];
    }
}
