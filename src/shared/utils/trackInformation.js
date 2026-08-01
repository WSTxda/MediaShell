/**
 * @file trackInformation.js
 * @module shared.utils.trackInformation
 *
 * Normalizes configurable track-information content lists.
 *
 * Shell settings and Preferences rows use one canonical policy so hand-edited
 * GSettings values are trimmed and empty lists fall back consistently.
 */

/**
 * Normalizes an ordered track-information content list.
 *
 * Duplicates are preserved because repeated fields or custom text are valid user
 * layout choices. The fallback is returned unchanged when input is unusable.
 *
 * @param {unknown} contentItems - Candidate ordered content list.
 * @param {string[]} fallback - Canonical fallback list.
 * @returns {string[]} Normalized content items or the fallback.
 */
export function normalizeTrackInformationContent(contentItems, fallback) {
  if (!Array.isArray(contentItems)) return fallback;
  const normalized = contentItems
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
}
