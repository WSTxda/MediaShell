/**
 * @file icons.js
 * @module shared.constants.icons
 *
 * Defines symbolic icon names used for runtime fallbacks.
 *
 * Icon names remain centralized so Shell UI and preferences use the same themed
 * fallback chain when application icons, media icons, or artwork are missing.
 * Only add entries here when an icon name is shared across modules.
 */

// --- Shared fallback icons ---

/** Symbolic icons used when concrete media, image, or app icons cannot be resolved */
export const IconNames = Object.freeze({
    MISSING: "image-missing-symbolic",
    MEDIA: "audio-x-generic-symbolic",
    APP: "application-x-executable-symbolic",
});
