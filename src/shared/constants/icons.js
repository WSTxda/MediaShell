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

/**
 * Symbolic fallback icons used when concrete media, image, or application icons
 * cannot be resolved.
 *
 * The names come from the current icon theme and are intentionally generic so
 * MediaShell can keep rendering even when an MPRIS app exposes incomplete identity
 * or artwork metadata.
 */
export const IconNames = Object.freeze({
  MISSING: "image-missing-symbolic",
  MEDIA: "audio-x-generic-symbolic",
  APP: "application-x-executable-symbolic",
});
