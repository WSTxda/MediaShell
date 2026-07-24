/**
 * @file ui.js
 * @module prefs.constants.ui
 *
 * Defines stable GtkBuilder object contracts owned by the preferences process.
 *
 * PreferencesController and repository validation consume the same page IDs so
 * renamed or missing top-level pages fail structurally instead of at runtime.
 */

/** Top-level preferences pages added to the Libadwaita window in display order. */
export const PREFERENCE_PAGE_IDS = Object.freeze([
  "page-popup",
  "page-top-bar",
  "page-panel",
  "page-interactions",
  "page-others",
]);
