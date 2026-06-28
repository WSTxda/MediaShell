/**
 * @file icons.js
 * @module shell.utils.icons
 *
 * Creates and updates Shell icons using MediaShell's common St.Icon conventions.
 *
 * Top-bar and popup playback controls use this utility so icon creation, themed
 * fallback handling, and GIcon updates remain consistent. Individual control renderers can update icons without constructing raw St.Icon
 * objects themselves.
 */

import Gio from "gi://Gio";
import St from "gi://St";

import { IconNames } from "../../shared/constants/icons.js";

const fallbackIcons = new Map();

function getFallbackIcon(primaryName) {
    const fallbackName = primaryName || IconNames.MISSING;
    if (fallbackIcons.has(fallbackName)) return fallbackIcons.get(fallbackName);

    const names = fallbackName === IconNames.MISSING ? [IconNames.MISSING] : [fallbackName, IconNames.MISSING];
    const icon = Gio.ThemedIcon.new_from_names(names);
    fallbackIcons.set(fallbackName, icon);
    return icon;
}

function setIconFallback(icon, fallbackIconName = IconNames.MISSING) {
    icon.set_fallback_gicon(getFallbackIcon(fallbackIconName));
    return icon;
}

export function createIcon(params = {}, fallbackIconName = IconNames.MISSING) {
    const { gicon = null, iconName = null, ...actorParams } = params;
    const icon = setIconFallback(new St.Icon(actorParams), fallbackIconName);

    // Install the fallback before assigning the primary icon. St can then
    // resolve a missing themed name or broken GIcon without a blank frame.
    if (gicon) icon.set_gicon(gicon);
    else if (iconName) icon.set_icon_name(iconName);
    else icon.set_gicon(getFallbackIcon(fallbackIconName));

    return icon;
}

export function setIconName(icon, iconName, fallbackIconName = IconNames.MISSING) {
    setIconFallback(icon, fallbackIconName);
    icon.set_icon_name(iconName || fallbackIconName);
}

export function setGIcon(icon, gicon, fallbackIconName = IconNames.MISSING) {
    setIconFallback(icon, fallbackIconName);
    icon.set_gicon(gicon ?? getFallbackIcon(fallbackIconName));
}

export function clearIconCache() {
    fallbackIcons.clear();
}
