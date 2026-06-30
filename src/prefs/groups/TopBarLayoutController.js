/**
 * @file TopBarLayoutController.js
 * @module prefs.groups.TopBarLayoutController
 *
 * Coordinates custom preference widgets that edit top bar layout.
 *
 * The controller owns only the element-order widget and persists its drag/drop
 * order to GSettings. Track-information content is coordinated by its own shared
 * controller because both popup and top bar use the same configurable editor.
 */

import { TOP_BAR_ELEMENT_ORDER_DEFAULT } from "../../shared/constants/settings.js";
import { normalizeOrderedValues } from "../../shared/utils/format.js";
import { createLogger } from "../../shared/utils/log.js";
import {
  connectOwnedSignal,
  disconnectOwnedSignals,
} from "../utils/SignalConnections.js";

const logger = createLogger("TopBarLayoutController");
const TOP_BAR_ELEMENT_ORDER_KEY = "top-bar-element-order";

function arraysEqual(first, second) {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

/**
 * Coordinates custom preference widgets that edit top bar layout.
 */
export default class TopBarLayoutController {
  constructor(settings, builder) {
    this.settings = settings;
    this.builder = builder;
    this.ownedSignalConnections = [];
  }

  init() {
    this.topBarElementOrderGroup = this.builder.get_object(
      "gp-panel-top-bar-element-order",
    );
    this.syncElementOrderFromSettings();

    this.connectOwnedSignal(
      this.topBarElementOrderGroup,
      "notify::element-order",
      () => {
        const elementOrder = this.topBarElementOrderGroup.elementOrder;
        if (
          !arraysEqual(
            elementOrder,
            this.settings.get_strv(TOP_BAR_ELEMENT_ORDER_KEY),
          )
        )
          this.settings.set_strv(TOP_BAR_ELEMENT_ORDER_KEY, elementOrder);
      },
    );
    this.connectOwnedSignal(
      this.settings,
      `changed::${TOP_BAR_ELEMENT_ORDER_KEY}`,
      () => this.syncElementOrderFromSettings(),
    );
  }

  syncElementOrderFromSettings() {
    const elementOrder = normalizeOrderedValues(
      this.settings.get_strv(TOP_BAR_ELEMENT_ORDER_KEY),
      TOP_BAR_ELEMENT_ORDER_DEFAULT,
    );
    if (!arraysEqual(elementOrder, this.topBarElementOrderGroup.elementOrder))
      this.topBarElementOrderGroup.setElementOrder(elementOrder);
  }

  connectOwnedSignal(object, signal, callback) {
    connectOwnedSignal(this.ownedSignalConnections, object, signal, callback);
  }

  destroy() {
    disconnectOwnedSignals(this.ownedSignalConnections, (error) => {
      logger.debug(
        "A top bar layout preference signal was already disconnected",
        error,
      );
    });
    this.topBarElementOrderGroup = null;
    this.settings = null;
    this.builder = null;
  }
}
