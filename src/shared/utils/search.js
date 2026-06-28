/**
 * @file search.js
 * @module shared.utils.search
 *
 * Builds tolerant text indexes for application and preference search.
 *
 * InstalledAppCatalog uses these helpers to compare names, desktop IDs, and
 * aliases without being sensitive to accents, punctuation, or case. Pure helpers
 * keep search behavior testable outside GTK and GNOME Shell.
 */

export function normalizeSearchText(value) {
    return String(value ?? "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .replace(/\s+/g, " ");
}

export function tokenizeSearchQuery(query) {
    const normalizedQuery = normalizeSearchText(query);
    return normalizedQuery ? normalizedQuery.split(" ") : [];
}

export function buildSearchIndex(values) {
    return values.map(normalizeSearchText).filter(Boolean).join(" ");
}

export function matchesSearchTokens(tokens, searchIndex) {
    if (tokens.length === 0) return true;
    return tokens.every((token) => searchIndex.includes(token));
}

export function matchesSearchText(query, values) {
    return matchesSearchTokens(tokenizeSearchQuery(query), buildSearchIndex(values));
}
