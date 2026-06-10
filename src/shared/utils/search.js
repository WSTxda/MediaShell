// Normalizes human-facing search input so GTK row filtering is deterministic across locales and punctuation.
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
