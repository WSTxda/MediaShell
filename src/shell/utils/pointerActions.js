/**
 * @file pointerActions.js
 * @module shell.utils.pointerActions
 *
 * Installs Shell pointer gestures and button-release fallbacks for actor actions.
 *
 * IndicatorPointerHandler uses this utility to translate click, double-click,
 * touch, and scroll events into MediaShell input actions. The fallback path is
 * kept local so top bar UI code does not depend on one Clutter gesture API.
 */

import Clutter from "gi://Clutter";

export function installPrimaryClickAction(
  actor,
  callback,
  shouldActivate = () => actor.reactive,
) {
  if (typeof Clutter.ClickGesture !== "undefined") {
    const gesture = new Clutter.ClickGesture();
    gesture.set_required_button(Clutter.BUTTON_PRIMARY);
    gesture.set_recognize_on_press(false);

    const signalId = gesture.connect("recognize", () => {
      if (!shouldActivate()) return;
      callback();
    });
    actor.add_action(gesture);

    return () => {
      gesture.disconnect(signalId);
      actor.remove_action(gesture);
    };
  }

  const signalId = actor.connect("button-release-event", (_actor, event) => {
    if (event.get_button() !== Clutter.BUTTON_PRIMARY)
      return Clutter.EVENT_PROPAGATE;
    if (!shouldActivate()) return Clutter.EVENT_PROPAGATE;

    callback();
    return Clutter.EVENT_STOP;
  });

  return () => actor.disconnect(signalId);
}
