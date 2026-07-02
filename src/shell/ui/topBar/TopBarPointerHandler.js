/**
 * @file TopBarPointerHandler.js
 * @module shell.ui.topBar.TopBarPointerHandler
 *
 * Installs pointer gestures for the non-playback regions of the top bar button.
 *
 * The handler translates mouse, touch, and scroll input into configured
 * InputActions while keeping transport-button clicks isolated from top bar
 * activation. It owns every signal, gesture, and delayed primary-activation
 * timeout installed for pointer handling and tears them down independently of
 * the top bar widget layout.
 *
 * @see src/shell/ui/topBar/TopBarButton.js
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";

import { InputActions } from "../../../shared/enums/input.js";
import { createLogger } from "../../../shared/utils/log.js";

const logger = createLogger("TopBarPointerHandler");

/**
 * Installs pointer gestures for the non-playback regions of the top bar button.
 */
export default class TopBarPointerHandler {
  constructor(topBarButton) {
    this.topBarButton = topBarButton;
    this.pointerActionCleanups = [];
    this.primaryActivationTimeoutId = null;
    this.disabledClickGesture = null;
  }

  get extensionController() {
    return this.topBarButton.extensionController;
  }

  install() {
    this.topBarButton.ensureTopBarLayout();

    if (
      this.topBarButton._clickGesture &&
      typeof this.topBarButton._clickGesture.set_enabled === "function"
    ) {
      this.topBarButton._clickGesture.set_enabled(false);
      this.disabledClickGesture = this.topBarButton._clickGesture;
    }

    for (const actor of [
      this.topBarButton.topBarActionBoxBefore,
      this.topBarButton.topBarActionBoxAfter,
    ])
      this.#installForActor(actor);
  }

  #installForActor(actor) {
    if (typeof Clutter.ClickGesture !== "undefined") {
      // GNOME 49+ removed the older Clutter click/tap action classes. GNOME 50 moved
      // PanelMenu.Button primary activation to ClickGesture. Install explicit
      // gestures on the non-playback area only, so transport buttons keep
      // ownership of their clicks without a hit-test.
      this.#addMouseButtonGesture(actor, Clutter.BUTTON_PRIMARY, () =>
        this.#handlePrimaryActivation(),
      );
      this.#addMouseButtonGesture(actor, Clutter.BUTTON_MIDDLE, () => {
        const mouseAction =
          this.extensionController.interactionsMouseActionMiddle;
        if (mouseAction !== InputActions.NONE)
          this.#executeMouseAction(mouseAction);
      });
      this.#addMouseButtonGesture(actor, Clutter.BUTTON_SECONDARY, () => {
        const mouseAction =
          this.extensionController.interactionsMouseActionRight;
        if (mouseAction !== InputActions.NONE)
          this.#executeMouseAction(mouseAction);
      });
    } else {
      // GNOME 47–48: use button-press-event / scroll-event signals.
      // These signals are still propagated by Clutter's input subsystem in
      // pre-49 releases and do not require gesture recognizers.
      this.#addPointerSignal(actor, "button-press-event", (_, event) => {
        const mouseButton = event.get_button();

        if (mouseButton === Clutter.BUTTON_PRIMARY) {
          this.#handlePrimaryActivation();
          return Clutter.EVENT_STOP;
        }

        let mouseAction;
        if (mouseButton === Clutter.BUTTON_MIDDLE) {
          mouseAction = this.extensionController.interactionsMouseActionMiddle;
        } else if (mouseButton === Clutter.BUTTON_SECONDARY) {
          mouseAction = this.extensionController.interactionsMouseActionRight;
        }

        if (mouseAction === InputActions.NONE) return Clutter.EVENT_PROPAGATE;

        this.#executeMouseAction(mouseAction);
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
        mouseAction = this.extensionController.interactionsMouseActionScrollUp;
      } else if (direction === Clutter.ScrollDirection.DOWN) {
        mouseAction =
          this.extensionController.interactionsMouseActionScrollDown;
      }

      if (mouseAction === InputActions.NONE) return Clutter.EVENT_PROPAGATE;

      this.#executeMouseAction(mouseAction);
      return Clutter.EVENT_STOP;
    });
  }

  #addPointerSignal(actor, signalName, callback) {
    const signalId = actor.connect(signalName, callback);
    this.pointerActionCleanups.push(() => {
      try {
        actor.disconnect(signalId);
      } catch (error) {
        logger.debug(
          "Pointer signal was already disconnected",
          signalName,
          error,
        );
      }
    });
  }

  #addMouseButtonGesture(actor, mouseButton, callback) {
    const gesture = new Clutter.ClickGesture();
    if (typeof gesture.set_required_button === "function")
      gesture.set_required_button(mouseButton);
    if (typeof gesture.set_recognize_on_press === "function")
      gesture.set_recognize_on_press(true);
    const signalId = gesture.connect("recognize", callback);
    actor.add_action(gesture);
    this.pointerActionCleanups.push(() => {
      try {
        gesture.disconnect(signalId);
      } catch (error) {
        logger.debug(
          "Pointer gesture signal was already disconnected",
          mouseButton,
          error,
        );
      }
      try {
        actor.remove_action(gesture);
      } catch (error) {
        logger.debug("Pointer gesture was already removed", mouseButton, error);
      }
    });
  }

  #handlePrimaryActivation() {
    // Primary activation delays the single-click/tap action only when a
    // double-click/double-tap action is configured.
    if (
      this.extensionController.interactionsMouseActionDouble ===
      InputActions.NONE
    ) {
      this.#executeMouseAction(
        this.extensionController.interactionsMouseActionLeft,
      );
      return;
    }

    if (this.primaryActivationTimeoutId === null) {
      this.primaryActivationTimeoutId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        250,
        () => {
          this.primaryActivationTimeoutId = null;
          this.#executeMouseAction(
            this.extensionController.interactionsMouseActionLeft,
          );
          return GLib.SOURCE_REMOVE;
        },
      );
    } else {
      GLib.Source.remove(this.primaryActivationTimeoutId);
      this.primaryActivationTimeoutId = null;
      this.#executeMouseAction(
        this.extensionController.interactionsMouseActionDouble,
      );
    }
  }

  #executeMouseAction(mouseAction) {
    this.extensionController.executeInputAction(mouseAction);
  }

  destroy() {
    for (const cleanup of this.pointerActionCleanups.splice(0).reverse())
      cleanup();
    if (this.primaryActivationTimeoutId !== null) {
      GLib.Source.remove(this.primaryActivationTimeoutId);
      this.primaryActivationTimeoutId = null;
    }
    if (
      this.disabledClickGesture &&
      typeof this.disabledClickGesture.set_enabled === "function"
    )
      this.disabledClickGesture.set_enabled(true);
    this.disabledClickGesture = null;
    this.topBarButton = null;
  }
}
