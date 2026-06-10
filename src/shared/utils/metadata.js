// Normalizes optional MPRIS metadata values into display-safe strings.
export function formatArtistNames(artistValue, fallback = "") {
    if (Array.isArray(artistValue)) return artistValue.filter(Boolean).join(", ") || fallback;
    if (typeof artistValue === "string" && artistValue.trim()) return artistValue;
    return fallback;
}
