/**
 * @file mediaApp.js
 * @module shared.constants.mediaApp
 *
 * Defines PlayerProxy state notifications that do not come from MPRIS.
 *
 * Runtime components subscribe to these names through PlayerProxy alongside
 * MPRIS properties, but their values are owned by MediaShell itself.
 */

export const MediaAppStateProperties = Object.freeze({
  IS_PINNED: "IsPinned",
  IS_MEDIA_APP_INVALID: "IsMediaAppInvalid",
});
