/**
 * @file input.js
 * @module prefs.constants.input
 *
 * Defines preferences-only shortcut grouping and key filtering policy.
 *
 * The shortcut editor and overview use the same stable section order, while
 * validation imports the GDK keyvals that must not become global media
 * shortcuts. Runtime action behavior remains in shared input definitions.
 */

import Gdk from "gi://Gdk";

/** Shortcut overview sections in display order. */
export const SHORTCUT_SECTION_ORDER = Object.freeze([
  "playback",
  "audio",
  "interface",
  "apps",
]);

/**
 * Navigation and mode-switch keyvals that cannot be saved as custom shortcuts.
 *
 * They are reserved by GTK/Shell navigation, too easy to trigger accidentally,
 * or not meaningful as global media controls.
 */
export const FORBIDDEN_SHORTCUT_KEYVALS = Object.freeze([
  Gdk.KEY_Home,
  Gdk.KEY_Left,
  Gdk.KEY_Up,
  Gdk.KEY_Right,
  Gdk.KEY_Down,
  Gdk.KEY_Page_Up,
  Gdk.KEY_Page_Down,
  Gdk.KEY_End,
  Gdk.KEY_Tab,
  Gdk.KEY_KP_Enter,
  Gdk.KEY_Return,
  Gdk.KEY_Mode_switch,
]);
