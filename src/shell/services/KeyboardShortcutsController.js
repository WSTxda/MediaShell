// Owns all global media-action shortcuts and guarantees matching removal on disable.
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { INPUT_ACTION_DEFINITIONS } from "../../shared/constants/inputActions.js";
import { InputActions } from "../../shared/enums/MediaShellEnums.js";
import { createLogger } from "../../shared/utils/log.js";

const logger = createLogger("KeyboardShortcutsController");

export default class KeyboardShortcutsController {
    constructor(settings, onInputAction) {
        this.settings = settings;
        this.onInputAction = onInputAction;
        this.registeredShortcutKeys = new Set();
    }

    enable() {
        if (this.registeredShortcutKeys.size > 0) return;

        for (const { action, shortcutKey } of INPUT_ACTION_DEFINITIONS) {
            try {
                const actionMode =
                    action === InputActions.TOGGLE_POPUP || action === InputActions.NEXT_APP
                        ? Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP
                        : Shell.ActionMode.NORMAL;
                Main.wm.addKeybinding(shortcutKey, this.settings, Meta.KeyBindingFlags.NONE, actionMode, () =>
                    this.onInputAction?.(action),
                );
                this.registeredShortcutKeys.add(shortcutKey);
            } catch (error) {
                logger.warn(`Failed to register keyboard shortcut ${shortcutKey}`, error);
            }
        }
        logger.debug("Registered media-action keybindings", this.registeredShortcutKeys.size);
    }

    destroy() {
        for (const shortcutKey of this.registeredShortcutKeys) {
            try {
                Main.wm.removeKeybinding(shortcutKey);
            } catch (error) {
                logger.debug(`Keyboard shortcut was already unavailable: ${shortcutKey}`, error);
            }
        }

        this.registeredShortcutKeys.clear();
        this.onInputAction = null;
        this.settings = null;
    }
}
