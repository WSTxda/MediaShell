// Normalizes MPRIS identity hints into deterministic desktop-app lookup candidates.
const DESKTOP_FILE_SUFFIX = ".desktop";
const MPRIS_BUS_NAME_PREFIX = "org.mpris.MediaPlayer2.";
const EPHEMERAL_BUS_SEGMENT_PATTERN = /^(?:instance|pid|process|tab|window)[-_]?[a-z0-9]*$/i;

function normalizeInput(value) {
    return String(value ?? "").trim();
}

export function stripDesktopFileSuffix(value) {
    const normalizedValue = normalizeInput(value);
    return normalizedValue.toLowerCase().endsWith(DESKTOP_FILE_SUFFIX)
        ? normalizedValue.slice(0, -DESKTOP_FILE_SUFFIX.length)
        : normalizedValue;
}

export function normalizeAppIdentity(value) {
    return stripDesktopFileSuffix(value)
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function addLookupHint(hints, value) {
    const rawValue = stripDesktopFileSuffix(value);
    if (!rawValue) return;

    hints.add(rawValue);
    hints.add(rawValue.toLowerCase());

    const normalizedValue = normalizeAppIdentity(rawValue);
    if (!normalizedValue) return;
    hints.add(normalizedValue);
    hints.add(normalizedValue.replaceAll(" ", "-"));
    hints.add(normalizedValue.replaceAll(" ", ""));
}

function addBusNameHints(hints, busName) {
    const normalizedBusName = normalizeInput(busName);
    if (!normalizedBusName.startsWith(MPRIS_BUS_NAME_PREFIX)) return;

    const busSuffix = normalizedBusName.slice(MPRIS_BUS_NAME_PREFIX.length);
    addLookupHint(hints, busSuffix);

    const segments = busSuffix.split(".").filter(Boolean);
    if (segments.length === 0) return;

    addLookupHint(hints, segments[0]);
    const ephemeralSegmentIndex = segments.findIndex(
        (segment, index) => index > 0 && EPHEMERAL_BUS_SEGMENT_PATTERN.test(segment),
    );
    if (ephemeralSegmentIndex > 0) addLookupHint(hints, segments.slice(0, ephemeralSegmentIndex).join("."));
}

export function buildAppLookupHints(identity, desktopEntry, busName = "") {
    const hints = new Set();
    addLookupHint(hints, desktopEntry);
    addLookupHint(hints, identity);
    addBusNameHints(hints, busName);
    return [...hints];
}

export function buildDesktopAppIdCandidates(identity, desktopEntry, busName = "") {
    const appIds = new Set();
    for (const hint of buildAppLookupHints(identity, desktopEntry, busName)) {
        const basename = stripDesktopFileSuffix(hint);
        if (!basename) continue;
        appIds.add(basename);
        appIds.add(`${basename}${DESKTOP_FILE_SUFFIX}`);
    }
    return [...appIds];
}

export function buildNormalizedAppIdentityCandidates(identity, desktopEntry, busName = "") {
    const identities = new Set();
    for (const hint of buildAppLookupHints(identity, desktopEntry, busName)) {
        const normalizedHint = normalizeAppIdentity(hint);
        if (normalizedHint) identities.add(normalizedHint);
    }
    return [...identities];
}
