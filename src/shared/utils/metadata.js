/**
 * @file metadata.js
 * @module shared.utils.metadata
 *
 * Normalizes user-facing MPRIS metadata strings for display widgets.
 *
 * PopupTrackInformation and TopBarTrackInformation use these helpers to avoid
 * leaking invalid artist, title, or album values into labels. The functions keep
 * display fallback behavior shared between popup and top-bar UI.
 */
export function formatArtistNames(artistValue, fallback = "") {
    if (Array.isArray(artistValue)) return artistValue.filter(Boolean).join(", ") || fallback;
    if (typeof artistValue === "string" && artistValue.trim()) return artistValue;
    return fallback;
}
