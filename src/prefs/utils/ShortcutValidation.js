// Validates keyboard accelerators using the same constraints as GNOME preferences.
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";

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

export function isValidAccelerator(mask, keyval) {
    return Gtk.accelerator_valid(keyval, mask) || (keyval === Gdk.KEY_Tab && mask !== 0);
}

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
