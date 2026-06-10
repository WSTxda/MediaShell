// Provides initialized extension gettext helpers to preferences modules.
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
