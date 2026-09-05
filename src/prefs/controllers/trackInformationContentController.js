/**
 * @file trackInformationContentController.js
 * @module prefs.controllers.trackInformationContentController
 *
 * Coordinates configurable track-information content rows with GSettings.
 *
 * Popup and top bar share the same editor widget but persist different ordered
 * content lists. This controller owns that synchronization so layout controllers
 * stay focused on placement and ordering of top-level UI elements.
 */

import {
  POPUP_TRACK_INFORMATION_CONTENT_DEFAULT,
  SettingsKeys,
  TOP_BAR_TRACK_INFORMATION_CONTENT_DEFAULT,
} from "../../shared/settings/contract.js";
import { arraysEqual } from "../ui/collections.js";
import { normalizeTrackInformationContent } from "../../shared/ui/trackInformationContent.js";
import {
  connectOwnedSignal,
  disconnectOwnedSignals,
} from "../utils/signalConnections.js";
import { gettext as _ } from "../translations.js";

/**
 * Coordinates configurable track-information content rows with GSettings.
 */
export default class TrackInformationContentController {
  constructor(settings, builder) {
    this.settings = settings;
    this.builder = builder;
    this.ownedSignalConnections = [];
  }

  init() {
    this.popupContentRow = this.builder.get_object(
      "er-popup-track-information-content",
    );
    this.topBarContentRow = this.builder.get_object(
      "er-top-bar-track-information-content",
    );
    this.popupContentRow.setCustomTextDefault(_("by"));

    this.syncPopupContentFromSettings();
    this.syncTopBarContentFromSettings();

    this.connectContentRow(
      this.popupContentRow,
      SettingsKeys.POPUP_TRACK_INFORMATION_CONTENT,
    );
    this.connectContentRow(
      this.topBarContentRow,
      SettingsKeys.TOP_BAR_TRACK_INFORMATION_CONTENT,
    );
    this.connectOwnedSignal(
      this.settings,
      `changed::${SettingsKeys.POPUP_TRACK_INFORMATION_CONTENT}`,
      () => this.syncPopupContentFromSettings(),
    );
    this.connectOwnedSignal(
      this.settings,
      `changed::${SettingsKeys.TOP_BAR_TRACK_INFORMATION_CONTENT}`,
      () => this.syncTopBarContentFromSettings(),
    );
  }

  connectContentRow(row, key) {
    this.connectOwnedSignal(row, "notify::content-items", () => {
      const contentItems = row.contentItems;
      if (!arraysEqual(contentItems, this.settings.get_strv(key)))
        this.settings.set_strv(key, contentItems);
    });
  }

  syncPopupContentFromSettings() {
    this.syncContentFromSettings(
      this.popupContentRow,
      SettingsKeys.POPUP_TRACK_INFORMATION_CONTENT,
      POPUP_TRACK_INFORMATION_CONTENT_DEFAULT,
    );
  }

  syncTopBarContentFromSettings() {
    this.syncContentFromSettings(
      this.topBarContentRow,
      SettingsKeys.TOP_BAR_TRACK_INFORMATION_CONTENT,
      TOP_BAR_TRACK_INFORMATION_CONTENT_DEFAULT,
    );
  }

  syncContentFromSettings(row, key, fallback) {
    const contentItems = normalizeTrackInformationContent(
      this.settings.get_strv(key),
      fallback,
    );
    if (!arraysEqual(contentItems, row.contentItems))
      row.setContentItems(contentItems);
  }

  connectOwnedSignal(object, signal, callback) {
    connectOwnedSignal(this.ownedSignalConnections, object, signal, callback);
  }

  destroy() {
    disconnectOwnedSignals(this.ownedSignalConnections);
    this.popupContentRow = null;
    this.topBarContentRow = null;
    this.settings = null;
    this.builder = null;
  }
}
