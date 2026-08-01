/**
 * @file mediaApp.js
 * @module shell.constants.mediaApp
 *
 * Defines Shell-owned media-app lifecycle policy.
 *
 * These values coordinate MprisMediaApp and MediaAppRegistry without exposing
 * runtime-only state as a shared process contract.
 */

/** Grace period before an empty stopped media app becomes invalid. */
export const MEDIA_APP_EMPTY_STOPPED_GRACE_MS = 5000;

/** Grace period for an MPRIS owner hand-off before endpoint removal. */
export const MEDIA_APP_DISAPPEARANCE_GRACE_MS = 5000;

/** MprisMediaApp notifications owned by MediaShell rather than MPRIS. */
export const MediaAppStateProperties = Object.freeze({
  IS_PINNED: "IsPinned",
  IS_MEDIA_APP_INVALID: "IsMediaAppInvalid",
});
