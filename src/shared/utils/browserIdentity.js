/**
 * @file browserIdentity.js
 * @module shared.utils.browserIdentity
 *
 * Resolves browser and PWA identity hints without depending on browser brand lists.
 *
 * Chromium-based PWAs expose a stable 32-character app ID in runtime and
 * desktop-entry fields, while launcher prefixes vary by browser, package, profile,
 * and distribution. These helpers compare the stable app ID instead of guessing
 * from browser names, windows, process IDs, or media-service titles.
 *
 * The resolver is deliberately conservative. A PWA is selected only when MPRIS
 * exposes one unambiguous Chromium app ID and one installed desktop entry has the
 * strongest matching metadata. Missing or conflicting evidence falls back to the
 * normal media-app identity path.
 */

const CHROMIUM_PWA_APP_ID_PATTERN = /^[a-p]{32}$/;
const CHROMIUM_PWA_TOKEN_PATTERN =
  /(?:^|[._-])(?:crx_)?([a-p]{32})(?=$|[._-])/gi;
const EXACT_CHROMIUM_PWA_TOKEN_PATTERN = /^(?:crx_)?([a-p]{32})$/i;
const CHROMIUM_PWA_COMMANDLINE_APP_ID_PATTERN =
  /(?:^|\s)--app-id(?:=|\s+)(?:"([a-p]{32})"|'([a-p]{32})'|([a-p]{32}))(?=$|\s)/gi;

const BROWSER_IDENTITY_SCORES = Object.freeze({
  desktopId: 1200,
  startupWmClass: 1100,
  commandline: 1000,
});

function normalizeDesktopId(value) {
  return String(value ?? "")
    .trim()
    .replace(/\.desktop$/i, "");
}

function addUnique(values, value) {
  if (value) values.add(value);
}

function extractMediaPwaAppIds(mediaIdentity) {
  return extractChromiumPwaAppIds(
    mediaIdentity.identity,
    mediaIdentity.desktopEntry,
    mediaIdentity.busName,
    mediaIdentity.extraHints ?? [],
  );
}

/**
 * Returns whether a value is a Chromium-style PWA app ID.
 *
 * Chromium web-app IDs are 32 lowercase characters in the `a-p` range. The
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
 * Supported examples include `crx_<id>`, `<browser>-<id>-Default`, Flatpak
 * desktop IDs prefixed with the package ID, and profile-specific variants. The
 * function requires token boundaries so a matching sequence embedded in a
 * larger identifier is not accepted accidentally.
 *
 * @param {...unknown} values - Runtime classes, desktop IDs, or identity hints.
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

    for (const match of text.matchAll(CHROMIUM_PWA_TOKEN_PATTERN))
      appIds.add(match[1]);
  }

  return [...appIds];
}

/**
 * Extracts app IDs from Chromium's explicit `--app-id` launcher argument.
 *
 * The command-line parser deliberately accepts only the documented switch form
 * instead of searching arbitrary executable text for a 32-character sequence.
 * Both `--app-id=<id>` and `--app-id <id>` are supported, with optional quotes.
 *
 * @param {...unknown} values - Desktop-entry command lines.
 * @returns {string[]} Unique lowercase PWA app IDs in discovery order.
 */
export function extractChromiumPwaCommandLineAppIds(...values) {
  const appIds = new Set();

  for (const value of values.flat()) {
    const commandline = String(value ?? "").toLowerCase();
    if (!commandline) continue;

    for (const match of commandline.matchAll(
      CHROMIUM_PWA_COMMANDLINE_APP_ID_PATTERN,
    ))
      appIds.add(match[1] ?? match[2] ?? match[3]);
  }

  return [...appIds];
}

/**
 * Resolves one unambiguous Chromium PWA app ID from MPRIS identity metadata.
 *
 * Conflicting IDs are not ranked. Returning an empty string forces the caller to
 * keep the normal browser identity instead of choosing one source arbitrarily.
 *
 * @param {object} mediaIdentity - MPRIS identity hints for one media app.
 * @param {unknown} [mediaIdentity.identity] - MPRIS Identity.
 * @param {unknown} [mediaIdentity.desktopEntry] - MPRIS DesktopEntry.
 * @param {unknown} [mediaIdentity.busName] - MPRIS bus name.
 * @param {unknown[]} [mediaIdentity.extraHints] - Optional explicit identity hints.
 * @returns {string} The unique lowercase app ID, or an empty string.
 */
export function resolveChromiumPwaAppId(mediaIdentity = {}) {
  const appIds = extractMediaPwaAppIds(mediaIdentity);
  return appIds.length === 1 ? appIds[0] : "";
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
 * @param {string} [descriptor.startupWmClass] - StartupWMClass desktop-entry key.
 * @param {string} [descriptor.commandline] - Desktop command line when available.
 * @returns {string[]} Search aliases derived from browser/PWA metadata.
 */
export function buildBrowserIdentityAliases(descriptor = {}) {
  const aliases = new Set();
  const metadataValues = [descriptor.desktopId, descriptor.startupWmClass];
  const appIds = new Set([
    ...extractChromiumPwaAppIds(metadataValues),
    ...extractChromiumPwaCommandLineAppIds(descriptor.commandline),
  ]);

  for (const appId of appIds) {
    addUnique(aliases, appId);
    addUnique(aliases, `crx_${appId}`);
  }

  return [...aliases];
}

/**
 * Scores how strongly an installed app descriptor matches a browser media app.
 *
 * The score uses only deterministic Chromium desktop integration metadata:
 * desktop ID, StartupWMClass, and the explicit `--app-id` launcher argument.
 * Display names, executable names, window titles, process IDs, and browser-brand
 * lists are intentionally excluded.
 *
 * @param {object} mediaIdentity - MPRIS/runtime identity hints for one media app.
 * @param {object} descriptor - Installed app descriptor.
 * @returns {{score: number, reason: string, appId: string}} Match score and explanation.
 */
export function scoreBrowserIdentityCandidate(
  mediaIdentity = {},
  descriptor = {},
) {
  const appIds = extractMediaPwaAppIds(mediaIdentity);
  if (appIds.length !== 1)
    return {
      score: 0,
      reason: appIds.length > 1 ? "ambiguous-pwa-app-id" : "no-pwa-app-id",
      appId: "",
    };

  const [appId] = appIds;
  const descriptorAppIds = new Set([
    ...extractChromiumPwaAppIds(
      descriptor.desktopId,
      descriptor.startupWmClass,
    ),
    ...extractChromiumPwaCommandLineAppIds(descriptor.commandline),
  ]);
  if (descriptorAppIds.size > 1)
    return {
      score: 0,
      reason: "conflicting-candidate-pwa-app-id",
      appId,
    };

  const evidence = [
    {
      field: "desktopId",
      score: BROWSER_IDENTITY_SCORES.desktopId,
      appIds: extractChromiumPwaAppIds(descriptor.desktopId),
    },
    {
      field: "startupWmClass",
      score: BROWSER_IDENTITY_SCORES.startupWmClass,
      appIds: extractChromiumPwaAppIds(descriptor.startupWmClass),
    },
    {
      field: "commandline",
      score: BROWSER_IDENTITY_SCORES.commandline,
      appIds: extractChromiumPwaCommandLineAppIds(descriptor.commandline),
    },
  ];

  for (const candidate of evidence) {
    if (candidate.appIds.includes(appId))
      return { score: candidate.score, reason: candidate.field, appId };
  }

  return { score: 0, reason: "no-match", appId };
}

/**
 * Selects one deterministic installed-app candidate for browser/PWA media.
 *
 * The best score must identify one desktop ID. Equal-strength matches for
 * different launchers are ambiguous and therefore return `null`; enumeration
 * order must never decide which browser profile or package owns the media app.
 *
 * @param {object} mediaIdentity - MPRIS/runtime identity hints for one media app.
 * @param {object[]} descriptors - Installed app descriptors to score.
 * @returns {{descriptor: object, score: number, reason: string, appId: string}|null} Best unambiguous match.
 */
export function resolveBrowserIdentityCandidate(mediaIdentity, descriptors) {
  const matches = [];

  for (const descriptor of descriptors ?? []) {
    const result = scoreBrowserIdentityCandidate(mediaIdentity, descriptor);
    if (result.score <= 0) continue;
    matches.push({ descriptor, ...result });
  }

  if (matches.length === 0) return null;

  const bestScore = Math.max(...matches.map((match) => match.score));
  const bestMatches = matches.filter((match) => match.score === bestScore);
  const bestDesktopIds = new Set(
    bestMatches
      .map((match) => normalizeDesktopId(match.descriptor.desktopId))
      .filter(Boolean),
  );

  if (bestDesktopIds.size !== 1) return null;
  return bestMatches[0];
}
