/**
 * @file preferencesUi.js
 * @module prefs.constants.preferencesUi
 *
 * Defines stable Preferences window contracts and shared presentation values.
 *
 * GtkBuilder page IDs are compatibility-sensitive resource contracts. Dialog
 * dimensions and feedback timings are preferences-wide policy for widgets built
 * in JavaScript. Keep this module value-only so importing it never initializes
 * GTK objects or process state.
 */

/** Top-level preferences pages added to the Libadwaita window in display order. */
export const PREFERENCE_PAGE_IDS = Object.freeze([
  "page-popup",
  "page-top-bar",
  "page-panel",
  "page-interactions",
  "page-others",
]);

/** Default width for large preferences dialogs such as app selection and shortcuts overview. */
export const LARGE_DIALOG_WIDTH = 480;

/** Default height for large preferences dialogs such as app selection and shortcuts overview. */
export const LARGE_DIALOG_HEIGHT = 600;

/** Width for the focused shortcut-capture dialog. */
export const SHORTCUT_DIALOG_WIDTH = 360;

/** Debounce delay for preferences search/filter updates, in milliseconds. */
export const SEARCH_DELAY_MS = 150;

/** Toast timeout used for short preferences feedback messages, in seconds. */
export const TOAST_TIMEOUT_SECONDS = 3;
