/**
 * @file preferenceSensitivityController.js
 * @module prefs.controllers.preferenceSensitivityController
 *
 * Keeps dependent preferences sensitive only when their parent toggles allow them.
 *
 * This controller watches the small set of settings that enable or disable
 * nested controls such as visualizer options and artwork rows. It owns no
 * persistent values; it only mirrors current settings into widget sensitivity.
 */

import { PlaybackControlModes } from "../../shared/playback/surfaces.js";
import {
  connectOwnedSignal,
  disconnectOwnedSignals,
} from "../bindings/signalConnections.js";

const PLAYBACK_CONTROL_SENSITIVITY_GROUPS = Object.freeze([
  {
    mode: "cr-popup-playback-controls-mode",
    controls: Object.freeze([
      "sr-popup-playback-controls-shuffle-show",
      "sr-popup-playback-controls-seek-backward-show",
      "sr-popup-playback-controls-previous-track-show",
      "sr-popup-playback-controls-play-pause-show",
      "sr-popup-playback-controls-next-track-show",
      "sr-popup-playback-controls-seek-forward-show",
      "sr-popup-playback-controls-repeat-show",
      "sr-popup-playback-controls-speed-show",
    ]),
  },
  {
    mode: "cr-top-bar-playback-controls-mode",
    controls: Object.freeze([
      "sr-top-bar-playback-controls-shuffle-show",
      "sr-top-bar-playback-controls-seek-backward-show",
      "sr-top-bar-playback-controls-previous-track-show",
      "sr-top-bar-playback-controls-play-pause-show",
      "sr-top-bar-playback-controls-next-track-show",
      "sr-top-bar-playback-controls-seek-forward-show",
      "sr-top-bar-playback-controls-repeat-show",
    ]),
  },
]);

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
      "sp-top-bar-track-information-scroll-pause-seconds",
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
      "sp-popup-track-information-scroll-pause-seconds",
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

    this.playbackControlSensitivityGroups =
      PLAYBACK_CONTROL_SENSITIVITY_GROUPS.map(({ mode, controls }) => {
        const modeRow = this.builder.get_object(mode);
        const controlRows = controls.map((id) => this.builder.get_object(id));
        this.connectOwnedSignal(modeRow, "notify::selected", () =>
          this.updatePlaybackControlSensitivity(),
        );
        return { modeRow, controlRows };
      });

    this.updateScrollingSensitivity();
    this.updateVisualizerSensitivity();
    this.updatePlaybackControlSensitivity();
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

  updatePlaybackControlSensitivity() {
    for (const { modeRow, controlRows } of this
      .playbackControlSensitivityGroups) {
      const isManual = modeRow.selected === PlaybackControlModes.MANUAL;
      for (const controlRow of controlRows) controlRow.sensitive = isManual;
    }
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
    this.playbackControlSensitivityGroups = null;
  }
}
