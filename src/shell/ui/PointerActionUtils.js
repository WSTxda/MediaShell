/**
 * @file PointerActionUtils.js
 * @module shell.ui.PointerActionUtils
 *
 * Installs Shell pointer gestures and button-release fallbacks for actor actions.
 *
 * TopBarPointerHandler uses this utility to translate click, double-click,
 * touch, and scroll events into MediaShell input actions. The fallback path is
 * kept local so top-bar UI code does not depend on one Clutter gesture API.
 */
import Clutter from "gi://Clutter";

function safeRemoveAction(actor, action) {
    try {
        actor?.remove_action?.(action);
    } catch {
        // The actor may already be disposed by the Shell during teardown.
    }
}

function safeDisconnect(actor, signalId) {
    try {
        actor?.disconnect?.(signalId);
    } catch {
        // The actor may already be disposed by the Shell during teardown.
    }
}

export function installPrimaryClickAction(actor, callback, shouldActivate = () => actor.reactive) {
    if (typeof Clutter.ClickGesture !== "undefined") {
        const gesture = new Clutter.ClickGesture();
        if (typeof gesture.set_required_button === "function") {
            gesture.set_required_button(Clutter.BUTTON_PRIMARY);
        }
        if (typeof gesture.set_recognize_on_press === "function") {
            gesture.set_recognize_on_press(false);
        }

        const signalId = gesture.connect("recognize", () => {
            if (!shouldActivate?.()) return;
            callback?.();
        });
        actor.add_action(gesture);

        return () => {
            safeDisconnect(gesture, signalId);
            safeRemoveAction(actor, gesture);
        };
    }

    const signalId = actor.connect("button-release-event", (_actor, event) => {
        if (event?.get_button?.() !== Clutter.BUTTON_PRIMARY) return Clutter.EVENT_PROPAGATE;
        if (!shouldActivate?.()) return Clutter.EVENT_PROPAGATE;

        callback?.();
        return Clutter.EVENT_STOP;
    });

    return () => safeDisconnect(actor, signalId);
}
