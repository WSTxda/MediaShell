/**
 * @file indicatorPointerHandler.js
 * @module shell.ui.indicator.indicatorPointerHandler
 *
 * Installs pointer gestures for the non-playback regions of the panel indicator.
 *
 * The handler translates mouse, touch, and scroll input into configured
 * InputActions while keeping playback control clicks isolated from top bar
 * activation. It owns every signal, gesture, and delayed primary-activation
 * timeout installed for pointer handling and tears them down independently of
 * the top bar widget layout.
 *
 * @see src/shell/ui/indicator/mediaShellIndicator.js
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";

import { InputActions } from "../../../shared/input/types.js";
import { suspendPanelMenuPrimaryActivation } from "../../integrations/panelMenu.js";

/**
 * Installs pointer gestures for the non-playback regions of the panel indicator.
 */
export default class IndicatorPointerHandler {
  constructor(indicator, inputActions) {
    this.indicator = indicator;
    this.inputActions = inputActions;
    this.pointerActionCleanups = [];
    this.primaryActivationTimeoutId = null;
    this.restoreDefaultPanelActivation = null;
  }

  get interactions() {
    return this.indicator.settings.interactions;
  }

  install() {
    this.indicator.topBarContent.ensureLayout();

    this.restoreDefaultPanelActivation = suspendPanelMenuPrimaryActivation(
      this.indicator,
    );

    for (const actor of [
      this.indicator.topBarContent.topBarActionBoxBefore,
      this.indicator.topBarContent.topBarActionBoxAfter,
    ])
      this.#installForActor(actor);
  }

  #installForActor(actor) {
    if (typeof Clutter.ClickGesture !== "undefined") {
      // GNOME 49+ removed the older Clutter click/tap action classes. GNOME 50 moved
      // PanelMenu.Button primary activation to ClickGesture. Install explicit
      // gestures on the non-playback area only, so playback control buttons keep
      // ownership of their clicks without a hit-test.
      this.#addMouseButtonGesture(actor, Clutter.BUTTON_PRIMARY, () =>
        this.#handlePrimaryActivation(),
      );
      this.#addMouseButtonGesture(actor, Clutter.BUTTON_MIDDLE, () => {
        const mouseAction = this.interactions.mouseActionMiddle;
        if (mouseAction !== InputActions.NONE)
          this.#executeInputAction(mouseAction);
      });
      this.#addMouseButtonGesture(actor, Clutter.BUTTON_SECONDARY, () => {
        const mouseAction = this.interactions.mouseActionRight;
        if (mouseAction !== InputActions.NONE)
          this.#executeInputAction(mouseAction);
      });
    } else {
      // Shell releases without Clutter.ClickGesture: fall back to
      // button-press-event / scroll-event signals, still propagated by
      // Clutter's input subsystem, so no gesture recognizer is required.
      this.#addPointerSignal(actor, "button-press-event", (_, event) => {
        const mouseButton = event.get_button();

        if (mouseButton === Clutter.BUTTON_PRIMARY) {
          this.#handlePrimaryActivation();
          return Clutter.EVENT_STOP;
        }

        let mouseAction;
        if (mouseButton === Clutter.BUTTON_MIDDLE) {
          mouseAction = this.interactions.mouseActionMiddle;
        } else if (mouseButton === Clutter.BUTTON_SECONDARY) {
          mouseAction = this.interactions.mouseActionRight;
        }

        if (mouseAction === InputActions.NONE) return Clutter.EVENT_PROPAGATE;

        this.#executeInputAction(mouseAction);
        return Clutter.EVENT_STOP;
      });

      this.#addPointerSignal(actor, "touch-event", (_, event) => {
        if (event.type() !== Clutter.EventType.TOUCH_BEGIN)
          return Clutter.EVENT_PROPAGATE;

        this.#handlePrimaryActivation();
        return Clutter.EVENT_STOP;
      });
    }

    this.#addPointerSignal(actor, "scroll-event", (_, event) => {
      const direction = event.get_scroll_direction();
      let mouseAction = InputActions.NONE;
      if (direction === Clutter.ScrollDirection.UP) {
        mouseAction = this.interactions.mouseActionScrollUp;
      } else if (direction === Clutter.ScrollDirection.DOWN) {
        mouseAction = this.interactions.mouseActionScrollDown;
      }

      if (mouseAction === InputActions.NONE) return Clutter.EVENT_PROPAGATE;

      this.#executeInputAction(mouseAction);
      return Clutter.EVENT_STOP;
    });
  }

  #addPointerSignal(actor, signalName, callback) {
    const signalId = actor.connect(signalName, callback);
    this.pointerActionCleanups.push(() => actor.disconnect(signalId));
  }

  #addMouseButtonGesture(actor, mouseButton, callback) {
    const gesture = new Clutter.ClickGesture();
    gesture.set_required_button(mouseButton);
    gesture.set_recognize_on_press(true);
    const signalId = gesture.connect("recognize", callback);
    actor.add_action(gesture);
    this.pointerActionCleanups.push(() => {
      gesture.disconnect(signalId);
      actor.remove_action(gesture);
    });
  }

  #handlePrimaryActivation() {
    // Primary activation delays the single-click/tap action only when a
    // double-click/double-tap action is configured.
    if (this.interactions.mouseActionDouble === InputActions.NONE) {
      this.#executeInputAction(this.interactions.mouseActionLeft);
      return;
    }

    if (this.primaryActivationTimeoutId === null) {
      this.primaryActivationTimeoutId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        250,
        () => {
          this.primaryActivationTimeoutId = null;
          this.#executeInputAction(this.interactions.mouseActionLeft);
          return GLib.SOURCE_REMOVE;
        },
      );
    } else {
      GLib.Source.remove(this.primaryActivationTimeoutId);
      this.primaryActivationTimeoutId = null;
      this.#executeInputAction(this.interactions.mouseActionDouble);
    }
  }

  #executeInputAction(inputAction) {
    this.inputActions?.execute(inputAction);
  }

  destroy() {
    for (const cleanup of this.pointerActionCleanups.splice(0).reverse())
      cleanup();
    if (this.primaryActivationTimeoutId !== null) {
      GLib.Source.remove(this.primaryActivationTimeoutId);
      this.primaryActivationTimeoutId = null;
    }
    this.restoreDefaultPanelActivation?.();
    this.restoreDefaultPanelActivation = null;
    this.inputActions = null;
    this.indicator = null;
  }
}
