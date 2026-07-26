/**
 * @file PopupLayoutController.js
 * @module prefs.controllers.PopupLayoutController
 *
 * Coordinates popup preferences that affect the minimum usable layout width.
 *
 * The controller observes width and seek visibility through owned signals. When
 * seek is enabled, it persists the shared full-size width contract without
 * reducing a larger value chosen by the user.
 */

import { POPUP_SEEK_CONTROLS_MIN_WIDTH } from "../../shared/constants/popup.js";
import { SettingsKeys } from "../../shared/constants/settings.js";
import { createLogger } from "../../shared/utils/log.js";
import {
  connectOwnedSignal,
  disconnectOwnedSignals,
} from "../utils/signalConnections.js";

const logger = createLogger("PopupLayoutController");
const POPUP_LAYOUT_SETTING_KEYS = Object.freeze([
  SettingsKeys.POPUP_WIDTH,
  SettingsKeys.POPUP_PLAYBACK_CONTROLS_SHOW,
  SettingsKeys.POPUP_PLAYBACK_CONTROLS_SEEK_BACKWARD_SHOW,
  SettingsKeys.POPUP_PLAYBACK_CONTROLS_SEEK_FORWARD_SHOW,
]);

/** Coordinates popup preferences that affect the minimum usable layout width. */
export default class PopupLayoutController {
  constructor(settings) {
    this.settings = settings;
    this.ownedSignalConnections = [];
  }

  init() {
    for (const key of POPUP_LAYOUT_SETTING_KEYS) {
      this.connectOwnedSignal(this.settings, `changed::${key}`, () =>
        this.syncWidth(),
      );
    }
    this.syncWidth();
  }

  syncWidth() {
    if (!this.settings.get_boolean(SettingsKeys.POPUP_PLAYBACK_CONTROLS_SHOW))
      return;

    const hasSeekControls =
      this.settings.get_boolean(
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_SEEK_BACKWARD_SHOW,
      ) ||
      this.settings.get_boolean(
        SettingsKeys.POPUP_PLAYBACK_CONTROLS_SEEK_FORWARD_SHOW,
      );
    if (!hasSeekControls) return;

    const width = this.settings.get_uint(SettingsKeys.POPUP_WIDTH);
    if (width >= POPUP_SEEK_CONTROLS_MIN_WIDTH) return;

    if (
      !this.settings.set_uint(
        SettingsKeys.POPUP_WIDTH,
        POPUP_SEEK_CONTROLS_MIN_WIDTH,
      )
    )
      logger.warnOnce(
        "seek-controls-width",
        "Failed to expand popup width for enabled seek controls",
      );
  }

  connectOwnedSignal(object, signal, callback) {
    connectOwnedSignal(this.ownedSignalConnections, object, signal, callback);
  }

  destroy() {
    disconnectOwnedSignals(this.ownedSignalConnections);
    this.settings = null;
  }
}
