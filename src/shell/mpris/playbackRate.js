/**
 * @file playbackRate.js
 * @module shell.mpris.playbackRate
 *
 * Pure playback-rate policy shared by state resolution and Shell execution.
 *
 * MPRIS publishes a continuous supported range rather than a discrete list.
 * MediaShell prefers sensible common multipliers, includes the published range
 * boundaries when useful, and always displays the later rate confirmed by the
 * player.
 */

/** Preferred playback multipliers presented when they fit the published range. */
const PLAYBACK_RATE_STEPS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2]);

const RATE_EPSILON = 1e-6;

/** Normalizes an MPRIS playback-rate range to a specification-safe shape. */
export function normalizePlaybackRateRange(minimumRate, maximumRate) {
  const minimum = Number(minimumRate);
  const maximum = Number(maximumRate);
  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    minimum <= 0 ||
    minimum > 1 ||
    maximum < 1 ||
    minimum > maximum
  )
    return { minimumRate: 1, maximumRate: 1 };

  return { minimumRate: minimum, maximumRate: maximum };
}

/**
 * Resolves useful positive rates inside the normalized MPRIS range.
 *
 * Published boundaries are included so a valid narrow range such as 0.8–1.2
 * still exposes meaningful alternatives even when no preferred step fits it.
 */
export function resolveAvailablePlaybackRates(minimumRate, maximumRate) {
  const range = normalizePlaybackRateRange(minimumRate, maximumRate);
  const candidates = new Set([1]);

  for (const rate of PLAYBACK_RATE_STEPS) {
    if (
      rate >= range.minimumRate - RATE_EPSILON &&
      rate <= range.maximumRate + RATE_EPSILON
    )
      candidates.add(rate);
  }
  if (range.minimumRate < 1 - RATE_EPSILON) candidates.add(range.minimumRate);
  if (range.maximumRate > 1 + RATE_EPSILON) candidates.add(range.maximumRate);

  return Object.freeze([...candidates].sort((left, right) => left - right));
}

/** Returns whether the published range exposes at least one alternative to 1x. */
export function canChangePlaybackRate(minimumRate, maximumRate) {
  return resolveAvailablePlaybackRates(minimumRate, maximumRate).length > 1;
}

/** Resolves the next useful rate after the current confirmed player rate. */
export function resolveNextPlaybackRate(currentRate, minimumRate, maximumRate) {
  const rates = resolveAvailablePlaybackRates(minimumRate, maximumRate);
  if (rates.length <= 1) return null;

  const current =
    Number.isFinite(currentRate) && currentRate > 0 ? currentRate : 1;
  const exactIndex = rates.findIndex(
    (rate) => Math.abs(rate - current) <= RATE_EPSILON,
  );
  if (exactIndex >= 0) return rates[(exactIndex + 1) % rates.length];

  return rates.find((rate) => rate > current + RATE_EPSILON) ?? rates[0];
}

/** Formats a confirmed playback multiplier using the active locale. */
export function formatPlaybackRate(rate, locales = undefined) {
  const normalized = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const formatted = new Intl.NumberFormat(locales, {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(normalized);
  return `${formatted}×`;
}
