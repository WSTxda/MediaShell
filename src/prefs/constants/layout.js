/**
 * @file layout.js
 * @module prefs.constants.layout
 *
 * Defines shared dimensions, spacing, and feedback timings for Preferences widgets built in JS.
 *
 * These values cover custom dialogs and rows that are not expressed directly in
 * GtkBuilder templates. Keep them preferences-only so Shell runtime code never
 * imports GTK-facing layout policy.
 */

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
