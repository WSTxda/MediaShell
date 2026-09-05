/**
 * @file presentation.js
 * @module prefs.ui.presentation
 *
 * Defines shared presentation values used across Preferences UI.
 *
 * Dialog dimensions and feedback timings are preferences-wide policy for widgets
 * built in JavaScript. Keep this module value-only so importing it never
 * initializes GTK objects or process state.
 */

/** Default width for large preferences dialogs such as app selection and shortcuts overview. */
export const LARGE_DIALOG_WIDTH = 480;

/** Default height for large preferences dialogs such as app selection and shortcuts overview. */
export const LARGE_DIALOG_HEIGHT = 600;

/** Width for the focused shortcut-capture dialog. */
export const SHORTCUT_DIALOG_WIDTH = 360;

/** Toast timeout used for short preferences feedback messages, in seconds. */
export const TOAST_TIMEOUT_SECONDS = 3;
