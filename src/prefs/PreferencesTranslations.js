/**
 * @file PreferencesTranslations.js
 * @module prefs.PreferencesTranslations
 *
 * Applies translatable labels and descriptions to the preferences UI.
 *
 * GtkBuilder files keep stable widget IDs while this module assigns translated
 * strings at runtime. This centralizes preference copy so controllers can bind
 * settings without duplicating user-facing text.
 */
let extensionGettext = null;
let extensionNgettext = null;

export function initializePreferencesTranslations(gettext, ngettext) {
    if (typeof gettext !== "function") throw new TypeError("Preferences gettext must be a function");
    if (typeof ngettext !== "function") throw new TypeError("Preferences ngettext must be a function");
    extensionGettext = gettext;
    extensionNgettext = ngettext;
}

export function gettext(message) {
    if (!extensionGettext) throw new Error("Preferences translations were used before initialization");
    return extensionGettext(message);
}

export function ngettext(singular, plural, count) {
    if (!extensionNgettext) throw new Error("Preferences translations were used before initialization");
    return extensionNgettext(singular, plural, count);
}
