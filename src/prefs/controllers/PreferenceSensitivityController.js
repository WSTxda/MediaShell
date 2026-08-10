/**
 * @file PreferenceSensitivityController.js
 * @module prefs.controllers.PreferenceSensitivityController
 *
 * Keeps dependent preferences sensitive only when their parent toggles allow them.
 *
 * This controller watches the small set of settings that enable or disable
 * nested controls such as visualizer options and album-art rows. It owns no
 * persistent values; it only mirrors current settings into widget sensitivity.
 */

import {
  connectOwnedSignal,
  disconnectOwnedSignals,
} from "../utils/signalConnections.js";

/**
 * Keeps dependent preferences sensitive only when their parent toggles allow them.
 */
export default class PreferenceSensitivityController {
  constructor(builder) {
    this.builder = builder;
    this.ownedSignalConnections = [];
  }

  init() {
    this.topBarTrackInformationRow = this.builder.get_object(
      "er-top-bar-track-information",
    );
    this.topBarTrackInformationScrollEnabledSwitch = this.builder.get_object(
      "sw-top-bar-track-information-scroll-enabled",
    );
    this.topBarTrackInformationScrollSpeedRow = this.builder.get_object(
      "sp-top-bar-track-information-scroll-speed",
    );
    this.topBarScrollPauseRow = this.builder.get_object(
      "sp-top-bar-track-information-scroll-pause-time",
    );
    this.topBarTrackInformationContentRow = this.builder.get_object(
      "er-top-bar-track-information-content",
    );
    this.popupTrackInformationRow = this.builder.get_object(
      "er-popup-track-information",
    );
    this.popupTrackInformationContentRow = this.builder.get_object(
      "er-popup-track-information-content",
    );
    this.popupTrackInformationScrollEnabledSwitch = this.builder.get_object(
      "sw-popup-track-information-scroll-enabled",
    );
    this.popupTrackInformationScrollSpeedRow = this.builder.get_object(
      "sp-popup-track-information-scroll-speed",
    );
    this.popupScrollPauseRow = this.builder.get_object(
      "sp-popup-track-information-scroll-pause-time",
    );

    this.connectOwnedSignal(
      this.topBarTrackInformationRow,
      "notify::enable-expansion",
      () => this.updateScrollingSensitivity(),
    );
    this.connectOwnedSignal(
      this.popupTrackInformationRow,
      "notify::enable-expansion",
      () => this.updateScrollingSensitivity(),
    );
    this.connectOwnedSignal(
      this.topBarTrackInformationScrollEnabledSwitch,
      "notify::active",
      () => this.updateScrollingSensitivity(),
    );
    this.connectOwnedSignal(
      this.popupTrackInformationScrollEnabledSwitch,
      "notify::active",
      () => this.updateScrollingSensitivity(),
    );
    this.visualizerRow = this.builder.get_object("er-top-bar-visualizer");
    this.visualizerStyleRow = this.builder.get_object(
      "cr-top-bar-visualizer-style",
    );
    this.visualizerSpeedRow = this.builder.get_object(
      "sp-top-bar-visualizer-speed",
    );
    this.connectOwnedSignal(
      this.visualizerRow,
      "notify::enable-expansion",
      () => this.updateVisualizerSensitivity(),
    );

    this.updateScrollingSensitivity();
    this.updateVisualizerSensitivity();
  }

  updateScrollingSensitivity() {
    const topBarScrollingEnabled =
      this.topBarTrackInformationRow.enableExpansion &&
      this.topBarTrackInformationScrollEnabledSwitch.active;
    this.topBarTrackInformationScrollSpeedRow.sensitive =
      topBarScrollingEnabled;
    this.topBarScrollPauseRow.sensitive = topBarScrollingEnabled;
    this.topBarTrackInformationContentRow.sensitive =
      this.topBarTrackInformationRow.enableExpansion;

    const popupScrollingEnabled =
      this.popupTrackInformationRow.enableExpansion &&
      this.popupTrackInformationScrollEnabledSwitch.active;
    this.popupTrackInformationScrollSpeedRow.sensitive = popupScrollingEnabled;
    this.popupScrollPauseRow.sensitive = popupScrollingEnabled;
    this.popupTrackInformationContentRow.sensitive =
      this.popupTrackInformationRow.enableExpansion;
  }

  updateVisualizerSensitivity() {
    const visualizerEnabled = this.visualizerRow.enableExpansion;
    this.visualizerStyleRow.sensitive = visualizerEnabled;
    this.visualizerSpeedRow.sensitive = visualizerEnabled;
  }

  connectOwnedSignal(object, signal, callback) {
    connectOwnedSignal(this.ownedSignalConnections, object, signal, callback);
  }

  destroy() {
    disconnectOwnedSignals(this.ownedSignalConnections);
    this.builder = null;
    this.topBarTrackInformationRow = null;
    this.topBarTrackInformationScrollEnabledSwitch = null;
    this.topBarTrackInformationScrollSpeedRow = null;
    this.topBarScrollPauseRow = null;
    this.topBarTrackInformationContentRow = null;
    this.popupTrackInformationRow = null;
    this.popupTrackInformationContentRow = null;
    this.popupTrackInformationScrollEnabledSwitch = null;
    this.popupTrackInformationScrollSpeedRow = null;
    this.popupScrollPauseRow = null;
    this.visualizerRow = null;
    this.visualizerStyleRow = null;
    this.visualizerSpeedRow = null;
  }
}
