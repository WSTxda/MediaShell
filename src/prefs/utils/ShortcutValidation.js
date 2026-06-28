/**
 * @file ShortcutValidation.js
 * @module prefs.utils.ShortcutValidation
 *
 * Validates keyboard accelerators entered in the preferences window.
 *
 * ShortcutsPageController uses this module to reject empty, malformed, or
 * reserved accelerator strings before persisting them to GSettings. The utility
 * keeps GTK accelerator parsing separate from controller state.
 */

import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";

/**
 * Plain navigation and mode-switch keyvals that should not be accepted as custom shortcuts.
 *
 * These are either reserved by GTK/Shell navigation, too easy to trigger
 * accidentally, or not meaningful as global media controls.
 */
const FORBIDDEN_KEYVALS = [
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
];

/**
 * Returns whether a keyval/mask pair can be represented as a GTK accelerator.
 *
 * Tab is accepted with a modifier even though Gtk.accelerator_valid() rejects it
 * directly, because GNOME commonly allows modified Tab shortcuts while still
 * rejecting bare Tab navigation.
 *
 * @param {number} mask - Modifier mask for the accelerator.
 * @param {number} keyval - GDK key value.
 * @returns {boolean} True when the pair can be saved as an accelerator string.
 */
export function isValidAccelerator(mask, keyval) {
    return Gtk.accelerator_valid(keyval, mask) || (keyval === Gdk.KEY_Tab && mask !== 0);
}

/**
 * Returns whether a captured key event should be accepted by the shortcut editor.
 *
 * The shortcut editor permits most modified shortcuts but rejects bare keys,
 * navigation keys, and Shift-only printable characters. That preserves GNOME
 * text/navigation behavior while still allowing international keyboard layouts.
 *
 * @param {number} mask - Modifier mask from the key event.
 * @param {number} keycode - Hardware keycode from the key event.
 * @param {number} keyval - GDK key value from the key event.
 * @returns {boolean} True when the event can become a MediaShell shortcut.
 */
export function isValidBinding(mask, keycode, keyval) {
    if (mask === 0) return false;

    if (mask !== Gdk.ModifierType.SHIFT_MASK || keycode === 0) return true;

    const isPlainLetter = (keyval >= Gdk.KEY_a && keyval <= Gdk.KEY_z) || (keyval >= Gdk.KEY_A && keyval <= Gdk.KEY_Z);
    const isPlainDigit = keyval >= Gdk.KEY_0 && keyval <= Gdk.KEY_9;
    const isLanguageCharacter =
        (keyval >= Gdk.KEY_kana_fullstop && keyval <= Gdk.KEY_semivoicedsound) ||
        (keyval >= Gdk.KEY_Arabic_comma && keyval <= Gdk.KEY_Arabic_sukun) ||
        (keyval >= Gdk.KEY_Serbian_dje && keyval <= Gdk.KEY_Cyrillic_HARDSIGN) ||
        (keyval >= Gdk.KEY_Greek_ALPHAaccent && keyval <= Gdk.KEY_Greek_omega) ||
        (keyval >= Gdk.KEY_hebrew_doublelowline && keyval <= Gdk.KEY_hebrew_taf) ||
        (keyval >= Gdk.KEY_Thai_kokai && keyval <= Gdk.KEY_Thai_lekkao) ||
        (keyval >= Gdk.KEY_Hangul_Kiyeog && keyval <= Gdk.KEY_Hangul_J_YeorinHieuh);

    return !isPlainLetter && !isPlainDigit && !isLanguageCharacter && !FORBIDDEN_KEYVALS.includes(keyval);
}
