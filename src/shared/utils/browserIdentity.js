/**
 * @file browserIdentity.js
 * @module shared.utils.browserIdentity
 *
 * Resolves browser and PWA identity hints without depending on browser brand lists.
 *
 * Chromium-based PWAs expose a stable 32-character app ID in several runtime and
 * desktop-entry fields, but the launcher prefix depends on the browser, package
 * format, profile, and distribution. These helpers score installed-app metadata
 * by evidence instead of hardcoding browser names, keeping Shell and preferences
 * identity resolution consistent and testable under Node.
 *
 * The resolver is deliberately conservative. It improves PWA identity only when
 * desktop-entry or runtime metadata expose a strong app-ID match; inconsistent
 * browser launchers fall back to the normal media-app identity path instead of
 * risking a wrong icon, display name, blocklist match, or focus target.
 */

const CHROMIUM_PWA_APP_ID_PATTERN = /^[a-p]{32}$/;
const CHROMIUM_PWA_TOKEN_PATTERN = /(?:^|[._-])(?:crx_)?([a-p]{32})(?=$|[._-])/gi;
const EXACT_CHROMIUM_PWA_TOKEN_PATTERN = /^(?:crx_)?([a-p]{32})$/i;
const STRONG_BROWSER_IDENTITY_SCORE = 900;

function normalizeText(value) {
    return String(value ?? "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function normalizeComparable(value) {
    return normalizeText(value)
        .replace(/\.desktop$/i, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}

function normalizeCompact(value) {
    return normalizeText(value).replace(/\.desktop$/i, "").replace(/[^a-z0-9]+/g, "");
}

function addUnique(values, value) {
    if (value) values.add(value);
}

/**
 * Returns whether a value is a Chromium-style PWA app ID.
 *
 * Chromium extension/PWA IDs are 32 lowercase characters in the `a-p` range. The
 * check is intentionally generic and does not assume a browser prefix such as
 * `chrome`, `brave`, or `chromium`.
 *
 * @param {unknown} value - Raw value to inspect.
 * @returns {boolean} Whether the value is an exact PWA app ID.
 */
export function isChromiumPwaAppId(value) {
    return CHROMIUM_PWA_APP_ID_PATTERN.test(String(value ?? "").toLowerCase());
}

/**
 * Extracts Chromium-style PWA app IDs from runtime or desktop-entry text.
 *
 * Supported examples include `crx_<id>`, `<browser>-<id>-Default`, Flatpak-style
 * desktop IDs that embed `<id>`, and profile-specific variants. The function is
 * pure and only returns the stable app ID, leaving candidate scoring to the
 * caller.
 *
 * @param {...unknown} values - Runtime classes, desktop IDs, command lines, or names.
 * @returns {string[]} Unique lowercase PWA app IDs in discovery order.
 */
export function extractChromiumPwaAppIds(...values) {
    const appIds = new Set();

    for (const value of values.flat()) {
        const text = String(value ?? "").toLowerCase();
        if (!text) continue;

        const exactMatch = text.match(EXACT_CHROMIUM_PWA_TOKEN_PATTERN);
        if (exactMatch) {
            appIds.add(exactMatch[1]);
            continue;
        }

        for (const match of text.matchAll(CHROMIUM_PWA_TOKEN_PATTERN)) appIds.add(match[1]);
    }

    return [...appIds];
}

/**
 * Builds normalized aliases for an installed app descriptor.
 *
 * Preferences use these aliases for search and Shell code uses the same shape to
 * score desktop entries. Keeping alias generation here prevents the blocked-app
 * chooser and runtime resolver from drifting apart for browser/PWA apps.
 *
 * @param {object} descriptor - Desktop app metadata.
 * @param {string} [descriptor.desktopId] - Desktop ID or file name.
 * @param {string} [descriptor.name] - App name.
 * @param {string} [descriptor.displayName] - Localized display name.
 * @param {string} [descriptor.executable] - Executable name.
 * @param {string} [descriptor.startupWmClass] - StartupWMClass desktop-entry key.
 * @param {string} [descriptor.commandline] - Desktop command line when available.
 * @returns {string[]} Search aliases derived from browser/PWA metadata.
 */
export function buildBrowserIdentityAliases(descriptor = {}) {
    const aliases = new Set();
    const values = [
        descriptor.desktopId,
        descriptor.name,
        descriptor.displayName,
        descriptor.executable,
        descriptor.startupWmClass,
        descriptor.commandline,
    ];

    for (const appId of extractChromiumPwaAppIds(values)) {
        addUnique(aliases, appId);
        addUnique(aliases, `crx_${appId}`);
    }

    return [...aliases];
}

/**
 * Scores how strongly an installed app descriptor matches a browser media app.
 *
 * The score is intentionally evidence based: desktop IDs and StartupWMClass are
 * strong signals, executable/command-line matches are weaker, and display names
 * are used only as a small tiebreaker when a PWA app ID was already discovered.
 * Low-confidence matches are expected to be ignored by the caller.
 *
 * @param {object} mediaIdentity - MPRIS/runtime identity hints for one media app.
 * @param {unknown} [mediaIdentity.identity] - MPRIS Identity.
 * @param {unknown} [mediaIdentity.desktopEntry] - MPRIS DesktopEntry.
 * @param {unknown} [mediaIdentity.busName] - MPRIS bus name.
 * @param {unknown[]} [mediaIdentity.extraHints] - Optional runtime hints such as WM_CLASS.
 * @param {object} descriptor - Installed app descriptor.
 * @returns {{score: number, reason: string, appId: string}} Match score and explanation.
 */
export function scoreBrowserIdentityCandidate(mediaIdentity = {}, descriptor = {}) {
    const mediaValues = [
        mediaIdentity.identity,
        mediaIdentity.desktopEntry,
        mediaIdentity.busName,
        ...(mediaIdentity.extraHints ?? []),
    ];
    const appIds = extractChromiumPwaAppIds(mediaValues);
    if (appIds.length === 0) return { score: 0, reason: "no-pwa-app-id", appId: "" };

    const descriptorValues = {
        desktopId: normalizeText(descriptor.desktopId),
        startupWmClass: normalizeText(descriptor.startupWmClass),
        commandline: normalizeText(descriptor.commandline),
        executable: normalizeText(descriptor.executable),
        name: normalizeComparable(descriptor.name),
        displayName: normalizeComparable(descriptor.displayName),
    };
    const descriptorCompactName = normalizeCompact(`${descriptor.name ?? ""} ${descriptor.displayName ?? ""}`);

    let best = { score: 0, reason: "no-match", appId: appIds[0] ?? "" };
    for (const appId of appIds) {
        const candidates = [
            { field: "desktopId", score: 1000, value: descriptorValues.desktopId },
            { field: "startupWmClass", score: 950, value: descriptorValues.startupWmClass },
            { field: "commandline", score: 700, value: descriptorValues.commandline },
            { field: "executable", score: 450, value: descriptorValues.executable },
        ];

        for (const candidate of candidates) {
            if (!candidate.value.includes(appId)) continue;
            if (candidate.score > best.score) best = { score: candidate.score, reason: candidate.field, appId };
        }

        if (descriptorCompactName.includes(appId) && 250 > best.score)
            best = { score: 250, reason: "name", appId };
    }

    return best;
}

/**
 * Selects the best installed-app candidate for a browser/PWA media app.
 *
 * The function returns `null` unless the best candidate crosses the strong-match
 * threshold. This conservative fallback keeps ordinary browser media endpoints
 * on the current identity path when the installed desktop database does not
 * provide enough evidence for a PWA-specific app.
 *
 * @param {object} mediaIdentity - MPRIS/runtime identity hints for one media app.
 * @param {object[]} descriptors - Installed app descriptors to score.
 * @returns {{descriptor: object, score: number, reason: string, appId: string}|null} Best strong match.
 */
export function resolveBrowserIdentityCandidate(mediaIdentity, descriptors) {
    let best = null;

    for (const descriptor of descriptors ?? []) {
        const result = scoreBrowserIdentityCandidate(mediaIdentity, descriptor);
        if (result.score <= 0) continue;
        if (!best || result.score > best.score)
            best = { descriptor, score: result.score, reason: result.reason, appId: result.appId };
    }

    return best && best.score >= STRONG_BROWSER_IDENTITY_SCORE ? best : null;
}
