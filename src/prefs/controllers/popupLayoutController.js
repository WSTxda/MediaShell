/**
 * @file popupLayoutController.js
 * @module prefs.controllers.popupLayoutController
 *
 * Keeps popup-width feedback aligned with the configured transport controls
 * without overwriting the user's preferred width when a wider runtime minimum
 * is temporarily required.
 */

import {
  POPUP_WIDTH_CONSTRAINTS,
  SettingsKeys,
} from "../../shared/settings/contract.js";
import {
  resolvePopupMinimumWidth,
  resolvePopupWidth,
} from "../../shared/ui/popupLayout.js";
import {
  connectOwnedSignal,
  disconnectOwnedSignals,
} from "../bindings/signalConnections.js";

const POPUP_LAYOUT_WIDGETS = Object.freeze({
  width: "sp-popup-width",
  controls: "er-popup-playback-controls",
  seekBackward: "sr-popup-playback-controls-seek-backward-show",
  previousTrack: "sr-popup-playback-controls-previous-track-show",
  playPause: "sr-popup-playback-controls-play-pause-show",
  nextTrack: "sr-popup-playback-controls-next-track-show",
  seekForward: "sr-popup-playback-controls-seek-forward-show",
});

function getRequiredObject(builder, id) {
  const object = builder.get_object(id);
  if (!object) throw new Error(`Preferences widget not found: ${id}`);
  return object;
}

/** Owns popup-width preference feedback and its transient layout minimum. */
export default class PopupLayoutController {
  constructor(settings, builder) {
    this.settings = settings;
    this.widthRow = getRequiredObject(builder, POPUP_LAYOUT_WIDGETS.width);
    this.controlsRow = getRequiredObject(
      builder,
      POPUP_LAYOUT_WIDGETS.controls,
    );
    this.seekBackwardRow = getRequiredObject(
      builder,
      POPUP_LAYOUT_WIDGETS.seekBackward,
    );
    this.previousTrackRow = getRequiredObject(
      builder,
      POPUP_LAYOUT_WIDGETS.previousTrack,
    );
    this.playPauseRow = getRequiredObject(
      builder,
      POPUP_LAYOUT_WIDGETS.playPause,
    );
    this.nextTrackRow = getRequiredObject(
      builder,
      POPUP_LAYOUT_WIDGETS.nextTrack,
    );
    this.seekForwardRow = getRequiredObject(
      builder,
      POPUP_LAYOUT_WIDGETS.seekForward,
    );
    this.ownedSignalConnections = [];
    this.syncGeneration = 0;
    this.syncingWidthRow = false;
  }

  init() {
    connectOwnedSignal(
      this.ownedSignalConnections,
      this.widthRow,
      "notify::value",
      () => this.syncConfiguredWidthFromRow(),
    );
    connectOwnedSignal(
      this.ownedSignalConnections,
      this.settings,
      `changed::${SettingsKeys.POPUP_WIDTH}`,
      () => this.scheduleWidthFeedback(),
    );

    for (const [widget, signal] of [
      [this.controlsRow, "notify::enable-expansion"],
      [this.seekBackwardRow, "notify::active"],
      [this.previousTrackRow, "notify::active"],
      [this.playPauseRow, "notify::active"],
      [this.nextTrackRow, "notify::active"],
      [this.seekForwardRow, "notify::active"],
    ]) {
      connectOwnedSignal(this.ownedSignalConnections, widget, signal, () =>
        this.scheduleWidthFeedback(),
      );
    }

    this.syncWidthFeedback();
  }

  scheduleWidthFeedback() {
    const syncGeneration = ++this.syncGeneration;
    void Promise.resolve().then(() => {
      if (syncGeneration !== this.syncGeneration || !this.settings) return;
      this.syncWidthFeedback();
    });
  }

  getTransportControlVisibility() {
    const showTransportControls = this.controlsRow.get_enable_expansion();
    return {
      showSeekBackward:
        showTransportControls && this.seekBackwardRow.get_active(),
      showPreviousTrack:
        showTransportControls && this.previousTrackRow.get_active(),
      showPlayPause: showTransportControls && this.playPauseRow.get_active(),
      showNextTrack: showTransportControls && this.nextTrackRow.get_active(),
      showSeekForward:
        showTransportControls && this.seekForwardRow.get_active(),
    };
  }

  syncWidthFeedback() {
    const configuredWidth = this.settings.get_uint(SettingsKeys.POPUP_WIDTH);
    const controls = this.getTransportControlVisibility();
    const minimumWidth = resolvePopupMinimumWidth(controls);
    const effectiveWidth = resolvePopupWidth(configuredWidth, controls);

    this.syncingWidthRow = true;
    try {
      this.widthRow.get_adjustment().set_lower(minimumWidth);
      if (this.widthRow.get_value() !== effectiveWidth)
        this.widthRow.set_value(effectiveWidth);
    } finally {
      this.syncingWidthRow = false;
    }
  }

  syncConfiguredWidthFromRow() {
    if (this.syncingWidthRow || !this.settings) return;

    const width = Math.trunc(this.widthRow.get_value());
    const configuredWidth = this.settings.get_uint(SettingsKeys.POPUP_WIDTH);
    if (width !== configuredWidth)
      this.settings.set_uint(SettingsKeys.POPUP_WIDTH, width);
  }

  destroy() {
    this.syncGeneration++;
    disconnectOwnedSignals(this.ownedSignalConnections);

    const adjustment = this.widthRow?.get_adjustment();
    if (adjustment) adjustment.set_lower(POPUP_WIDTH_CONSTRAINTS.MIN);

    this.widthRow = null;
    this.controlsRow = null;
    this.seekBackwardRow = null;
    this.previousTrackRow = null;
    this.playPauseRow = null;
    this.nextTrackRow = null;
    this.seekForwardRow = null;
    this.settings = null;
  }
}
