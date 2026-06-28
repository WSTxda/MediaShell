/**
 * @file appIdentity.js
 * @module shared.utils.appIdentity
 *
 * Normalizes MPRIS bus names, identities, and desktop-entry hints into app IDs.
 *
 * MediaAppResolver and installed-app search rely on these helpers to strip
 * unstable browser/session suffixes and desktop-file extensions. The functions
 * are pure so both Shell and preferences code can use the same matching rules.
 */

const DESKTOP_FILE_SUFFIX = ".desktop";
const MPRIS_BUS_NAME_PREFIX = "org.mpris.MediaPlayer2.";
const EPHEMERAL_BUS_SEGMENT_PATTERN = /^(?:instance|pid|process|tab|window)[-_]?[a-z0-9]*$/i;

function normalizeInput(value) {
    return String(value ?? "").trim();
}

/**
 * Removes a `.desktop` suffix without changing the rest of the identifier.
 *
 * @param {unknown} value - Raw desktop entry or app ID.
 * @returns {string} Identifier without a desktop-file suffix.
 */
export function stripDesktopFileSuffix(value) {
    const normalizedValue = normalizeInput(value);
    return normalizedValue.toLowerCase().endsWith(DESKTOP_FILE_SUFFIX)
        ? normalizedValue.slice(0, -DESKTOP_FILE_SUFFIX.length)
        : normalizedValue;
}

/**
 * Converts an app identity into a search-friendly comparable form.
 *
 * Accents, punctuation, case, and desktop-file suffixes are normalized so MPRIS
 * identities, desktop entries, and installed-app names can be matched with the
 * same rules.
 *
 * @param {unknown} value - Raw app identity text.
 * @returns {string} Normalized lookup text.
 */
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

/**
 * Builds all lookup hints MediaShell can derive for one media app.
 *
 * The result combines desktop-entry, identity, and bus-name candidates. Browser
 * sessions often append tab/window/process suffixes to the MPRIS bus; those are
 * reduced to stable prefixes so the Shell app resolver can still find the owning
 * desktop app.
 *
 * @param {unknown} identity - MPRIS Identity value.
 * @param {unknown} desktopEntry - MPRIS DesktopEntry value.
 * @param {string} busName - Full MPRIS bus name.
 * @returns {string[]} Unique raw and normalized lookup hints.
 */
export function buildAppLookupHints(identity, desktopEntry, busName = "") {
    const hints = new Set();
    addLookupHint(hints, desktopEntry);
    addLookupHint(hints, identity);
    addBusNameHints(hints, busName);
    return [...hints];
}

/**
 * Builds desktop-app ID candidates from media-app identity metadata.
 *
 * @param {unknown} identity - MPRIS Identity value.
 * @param {unknown} desktopEntry - MPRIS DesktopEntry value.
 * @param {string} busName - Full MPRIS bus name.
 * @returns {string[]} Candidate desktop IDs with and without `.desktop` suffixes.
 */
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

/**
 * Builds normalized identity candidates for fuzzy installed-app matching.
 *
 * @param {unknown} identity - MPRIS Identity value.
 * @param {unknown} desktopEntry - MPRIS DesktopEntry value.
 * @param {string} busName - Full MPRIS bus name.
 * @returns {string[]} Normalized comparable identity values.
 */
export function buildNormalizedAppIdentityCandidates(identity, desktopEntry, busName = "") {
    const identities = new Set();
    for (const hint of buildAppLookupHints(identity, desktopEntry, busName)) {
        const normalizedHint = normalizeAppIdentity(hint);
        if (normalizedHint) identities.add(normalizedHint);
    }
    return [...identities];
}
