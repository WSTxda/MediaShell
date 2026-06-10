// Keeps dependent preference controls sensitive only when their parent features are enabled.
import { createLogger } from "../../shared/utils/log.js";

const logger = createLogger("PreferenceSensitivityController");

export default class PreferenceSensitivityController {
    constructor(builder) {
        this.builder = builder;
        this.ownedSignalConnections = [];
    }

    init() {
        this.topBarTrackInformationRow = this.builder.get_object("er-top-bar-track-information");
        this.topBarScrollTrackInformationRow = this.builder.get_object("sr-top-bar-scroll-track-information");
        this.topBarScrollTrackInformationSwitch = this.builder.get_object("sw-top-bar-scroll-track-information");
        this.topBarScrollSpeedRow = this.builder.get_object("sp-top-bar-scroll-speed");
        this.topBarScrollPauseRow = this.builder.get_object("sp-top-bar-scroll-pause");
        this.topBarTrackInformationContentRow = this.builder.get_object("er-top-bar-track-information-content");
        this.popupTrackInformationRow = this.builder.get_object("er-popup-track-information");
        this.popupScrollTrackInformationRow = this.builder.get_object("sr-popup-scroll-track-information");
        this.popupScrollTrackInformationSwitch = this.builder.get_object("sw-popup-scroll-track-information");
        this.popupScrollSpeedRow = this.builder.get_object("sp-popup-scroll-speed");
        this.popupScrollPauseRow = this.builder.get_object("sp-popup-scroll-pause");

        this.connectOwnedSignal(this.topBarTrackInformationRow, "notify::enable-expansion", () => this.updateScrollingSensitivity());
        this.connectOwnedSignal(this.popupTrackInformationRow, "notify::enable-expansion", () => this.updateScrollingSensitivity());
        this.connectOwnedSignal(this.topBarScrollTrackInformationSwitch, "notify::active", () => this.updateScrollingSensitivity());
        this.connectOwnedSignal(this.popupScrollTrackInformationSwitch, "notify::active", () => this.updateScrollingSensitivity());
        this.visualizerRow = this.builder.get_object("er-top-bar-visualizer");
        this.visualizerStyleRow = this.builder.get_object("cr-top-bar-visualizer-style");
        this.visualizerSpeedRow = this.builder.get_object("sp-top-bar-visualizer-speed");
        this.connectOwnedSignal(this.visualizerRow, "notify::enable-expansion", () => this.updateVisualizerSensitivity());

        this.updateScrollingSensitivity();
        this.updateVisualizerSensitivity();
    }

    updateScrollingSensitivity() {
        const topBarScrollingEnabled =
            this.topBarTrackInformationRow.enableExpansion && this.topBarScrollTrackInformationSwitch.active;
        this.topBarScrollSpeedRow.sensitive = topBarScrollingEnabled;
        this.topBarScrollPauseRow.sensitive = topBarScrollingEnabled;
        this.topBarTrackInformationContentRow.sensitive = this.topBarTrackInformationRow.enableExpansion;

        const popupScrollingEnabled =
            this.popupTrackInformationRow.enableExpansion && this.popupScrollTrackInformationSwitch.active;
        this.popupScrollSpeedRow.sensitive = popupScrollingEnabled;
        this.popupScrollPauseRow.sensitive = popupScrollingEnabled;
    }

    updateVisualizerSensitivity() {
        const visualizerEnabled = this.visualizerRow.enableExpansion;
        this.visualizerStyleRow.sensitive = visualizerEnabled;
        this.visualizerSpeedRow.sensitive = visualizerEnabled;
    }

    connectOwnedSignal(object, signal, callback) {
        const signalId = object.connect(signal, callback);
        this.ownedSignalConnections.push({ object, signalId });
    }

    destroy() {
        for (const { object, signalId } of this.ownedSignalConnections) {
            try {
                object.disconnect(signalId);
            } catch (error) {
                logger.debug("A preference sensitivity signal was already disconnected", error);
            }
        }
        this.ownedSignalConnections.length = 0;
        this.builder = null;
        this.topBarTrackInformationRow = null;
        this.topBarScrollTrackInformationRow = null;
        this.topBarScrollTrackInformationSwitch = null;
        this.topBarScrollSpeedRow = null;
        this.topBarScrollPauseRow = null;
        this.topBarTrackInformationContentRow = null;
        this.popupTrackInformationRow = null;
        this.popupScrollTrackInformationRow = null;
        this.popupScrollTrackInformationSwitch = null;
        this.popupScrollSpeedRow = null;
        this.popupScrollPauseRow = null;
        this.visualizerRow = null;
        this.visualizerStyleRow = null;
        this.visualizerSpeedRow = null;
    }
}
