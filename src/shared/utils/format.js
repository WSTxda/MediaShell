// Provides small allocation-conscious formatting and enum conversion helpers.
export function enumValueByIndex(enumObject, index) {
    return Object.values(enumObject)[index];
}

export function formatDurationMilliseconds(milliseconds) {
    const normalizedMilliseconds = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
    const seconds = Math.floor(normalizedMilliseconds / 1000);
    const minutes = Math.floor(normalizedMilliseconds / 60000);
    const hours = Math.floor(normalizedMilliseconds / 3600000);
    const secondsString = String(seconds % 60).padStart(2, "0");
    const minutesString = String(minutes % 60).padStart(2, "0");

    if (hours > 0) return `${String(hours).padStart(2, "0")}:${minutesString}:${secondsString}`;

    return `${minutesString}:${secondsString}`;
}

export function normalizeUniqueStrings(values) {
    const normalizedValues = [];
    const seenValues = new Set();
    for (const value of values ?? []) {
        const normalizedValue = String(value ?? "").trim();
        if (!normalizedValue || seenValues.has(normalizedValue)) continue;
        seenValues.add(normalizedValue);
        normalizedValues.push(normalizedValue);
    }
    return normalizedValues;
}

export function normalizeOrderedValues(values, allowedValues) {
    const allowedValueSet = new Set(allowedValues);
    const normalizedValues = [];
    for (const value of values ?? []) {
        if (!allowedValueSet.has(value) || normalizedValues.includes(value)) continue;
        normalizedValues.push(value);
    }
    for (const value of allowedValues) {
        if (!normalizedValues.includes(value)) normalizedValues.push(value);
    }
    return normalizedValues;
}
