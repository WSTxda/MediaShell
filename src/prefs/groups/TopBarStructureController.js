/**
 * @file TopBarStructureController.js
 * @module prefs.groups.TopBarStructureController
 *
 * Coordinates custom preference widgets that edit the top-bar layout.
 *
 * The controller owns the element-order widget and the track-information content
 * row, connecting their drag/drop and selection signals to GSettings. It keeps
 * layout-specific preference behavior out of the generic binding table.
 */
import { TOP_BAR_ELEMENT_ORDER_DEFAULT } from "../../shared/constants/settings.js";
import { normalizeOrderedValues } from "../../shared/utils/format.js";
import { createLogger } from "../../shared/utils/log.js";
import { connectOwnedSignal, disconnectOwnedSignals } from "../utils/SignalConnections.js";

const logger = createLogger("TopBarStructureController");

function arraysEqual(first, second) {
    return first.length === second.length && first.every((value, index) => value === second[index]);
}

export default class TopBarStructureController {
    constructor(settings, builder) {
        this.settings = settings;
        this.builder = builder;
        this.ownedSignalConnections = [];
    }

    init() {
        this.topBarElementOrderGroup = this.builder.get_object("gp-panel-top-bar-element-order");
        this.topBarTrackInformationContentRow = this.builder.get_object("er-top-bar-track-information-content");
        this.syncElementOrderFromSettings();
        this.syncTrackInformationContentFromSettings();

        this.connectOwnedSignal(this.topBarElementOrderGroup, "notify::element-order", () => {
            const elementOrder = this.topBarElementOrderGroup.elementOrder;
            if (!arraysEqual(elementOrder, this.settings.get_strv("top-bar-element-order")))
                this.settings.set_strv("top-bar-element-order", elementOrder);
        });
        this.connectOwnedSignal(this.topBarTrackInformationContentRow, "notify::content-items", () => {
            const contentItems = this.topBarTrackInformationContentRow.contentItems;
            if (!arraysEqual(contentItems, this.settings.get_strv("top-bar-track-information-content")))
                this.settings.set_strv("top-bar-track-information-content", contentItems);
        });
        this.connectOwnedSignal(this.settings, "changed::top-bar-element-order", () =>
            this.syncElementOrderFromSettings(),
        );
        this.connectOwnedSignal(this.settings, "changed::top-bar-track-information-content", () =>
            this.syncTrackInformationContentFromSettings(),
        );
    }

    syncElementOrderFromSettings() {
        const elementOrder = normalizeOrderedValues(
            this.settings.get_strv("top-bar-element-order"),
            TOP_BAR_ELEMENT_ORDER_DEFAULT,
        );
        if (!arraysEqual(elementOrder, this.topBarElementOrderGroup.elementOrder))
            this.topBarElementOrderGroup.setElementOrder(elementOrder);
    }

    syncTrackInformationContentFromSettings() {
        const contentItems = this.settings.get_strv("top-bar-track-information-content");
        if (!arraysEqual(contentItems, this.topBarTrackInformationContentRow.contentItems))
            this.topBarTrackInformationContentRow.setContentItems(contentItems);
    }

    connectOwnedSignal(object, signal, callback) {
        connectOwnedSignal(this.ownedSignalConnections, object, signal, callback);
    }

    destroy() {
        disconnectOwnedSignals(this.ownedSignalConnections, (error) => {
            logger.debug("A top bar structure preference signal was already disconnected", error);
        });
        this.topBarElementOrderGroup = null;
        this.topBarTrackInformationContentRow = null;
        this.settings = null;
        this.builder = null;
    }
}
