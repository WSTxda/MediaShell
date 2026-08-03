/**
 * @file PopupLayoutController.js
 * @module prefs.controllers.PopupLayoutController
 *
 * Keeps the stored popup width aligned with seek controls changed in Preferences.
 *
 * Runtime sizing remains defensive through resolvePopupWidth(). This controller
 * adds visible settings feedback only after a preference widget changes; opening
 * Preferences never rewrites the user's configuration.
 */

import { SettingsKeys } from "../../shared/constants/settings.js";
import { resolvePopupWidth } from "../../shared/utils/popupLayout.js";
import {
  connectOwnedSignal,
  disconnectOwnedSignals,
} from "../utils/signalConnections.js";

const POPUP_LAYOUT_WIDGETS = Object.freeze({
  controls: "er-popup-playback-controls",
  seekBackward: "sr-popup-playback-controls-seek-backward-show",
  seekForward: "sr-popup-playback-controls-seek-forward-show",
});

function getRequiredObject(builder, id) {
  const object = builder.get_object(id);
  if (!object) throw new Error(`Preferences widget not found: ${id}`);
  return object;
}

/** Keeps popup-width feedback aligned with visible seek controls. */
export default class PopupLayoutController {
  constructor(settings, builder) {
    this.settings = settings;
    this.controlsRow = getRequiredObject(
      builder,
      POPUP_LAYOUT_WIDGETS.controls,
    );
    this.seekBackwardRow = getRequiredObject(
      builder,
      POPUP_LAYOUT_WIDGETS.seekBackward,
    );
    this.seekForwardRow = getRequiredObject(
      builder,
      POPUP_LAYOUT_WIDGETS.seekForward,
    );
    this.ownedSignalConnections = [];
    this.syncGeneration = 0;
  }

  init() {
    for (const [widget, signal] of [
      [this.controlsRow, "notify::enable-expansion"],
      [this.seekBackwardRow, "notify::active"],
      [this.seekForwardRow, "notify::active"],
    ]) {
      connectOwnedSignal(this.ownedSignalConnections, widget, signal, () =>
        this.scheduleWidthFeedback(),
      );
    }
  }

  scheduleWidthFeedback() {
    const syncGeneration = ++this.syncGeneration;
    void Promise.resolve().then(() => {
      if (syncGeneration !== this.syncGeneration || !this.settings) return;
      this.syncWidthAfterPreferenceChange();
    });
  }

  syncWidthAfterPreferenceChange() {
    if (!this.controlsRow.get_enable_expansion()) return;

    const configuredWidth = this.settings.get_uint(SettingsKeys.POPUP_WIDTH);
    const effectiveWidth = resolvePopupWidth(
      configuredWidth,
      this.seekBackwardRow.get_active(),
      this.seekForwardRow.get_active(),
    );
    if (effectiveWidth !== configuredWidth)
      this.settings.set_uint(SettingsKeys.POPUP_WIDTH, effectiveWidth);
  }

  destroy() {
    this.syncGeneration++;
    disconnectOwnedSignals(this.ownedSignalConnections);
    this.controlsRow = null;
    this.seekBackwardRow = null;
    this.seekForwardRow = null;
    this.settings = null;
  }
}
