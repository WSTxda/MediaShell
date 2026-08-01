/**
 * @file mediaAppValidity.js
 * @module shared.enums.mediaAppValidity
 *
 * Enum values describing whether an MPRIS endpoint is usable as a media app.
 *
 * MprisMediaApp computes MediaAppValidity from root and Player-interface properties, and
 * MediaAppRegistry uses the result to decide whether a media app should be visible
 * to the top bar and popup. Values are runtime-only and must remain stable for
 * tests that exercise selection policy.
 */

export const MediaAppValidity = Object.freeze({
  INVALID: "invalid",
  VALID: "valid",
  EMPTY_STOPPED_GRACE: "empty-stopped-grace",
});
