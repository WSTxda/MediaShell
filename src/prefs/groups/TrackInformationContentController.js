/**
 * @file TrackInformationContentController.js
 * @module prefs.groups.TrackInformationContentController
 *
 * Coordinates configurable track-information content rows with GSettings.
 *
 * Popup and top bar share the same editor widget but persist different ordered
 * content lists. This controller owns that synchronization so layout controllers
 * stay focused on placement and ordering of top-level UI elements.
 */

import {
  POPUP_TRACK_INFORMATION_CONTENT_DEFAULT,
  TOP_BAR_TRACK_INFORMATION_CONTENT_DEFAULT,
} from "../../shared/constants/settings.js";
import { createLogger } from "../../shared/utils/log.js";
import {
  connectOwnedSignal,
  disconnectOwnedSignals,
} from "../utils/SignalConnections.js";
import { gettext as _ } from "../PreferencesTranslations.js";

const logger = createLogger("TrackInformationContentController");
const POPUP_CONTENT_KEY = "popup-track-information-content";
const TOP_BAR_CONTENT_KEY = "top-bar-track-information-content";

function arraysEqual(first, second) {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function normalizeContentItems(contentItems, fallback) {
  if (!Array.isArray(contentItems)) return fallback;
  const normalized = contentItems
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
}

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

    this.connectContentRow(this.popupContentRow, POPUP_CONTENT_KEY);
    this.connectContentRow(this.topBarContentRow, TOP_BAR_CONTENT_KEY);
    this.connectOwnedSignal(
      this.settings,
      `changed::${POPUP_CONTENT_KEY}`,
      () => this.syncPopupContentFromSettings(),
    );
    this.connectOwnedSignal(
      this.settings,
      `changed::${TOP_BAR_CONTENT_KEY}`,
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
      POPUP_CONTENT_KEY,
      POPUP_TRACK_INFORMATION_CONTENT_DEFAULT,
    );
  }

  syncTopBarContentFromSettings() {
    this.syncContentFromSettings(
      this.topBarContentRow,
      TOP_BAR_CONTENT_KEY,
      TOP_BAR_TRACK_INFORMATION_CONTENT_DEFAULT,
    );
  }

  syncContentFromSettings(row, key, fallback) {
    const contentItems = normalizeContentItems(
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
    disconnectOwnedSignals(this.ownedSignalConnections, (error) => {
      logger.debug(
        "A track information content preference signal was already disconnected",
        error,
      );
    });
    this.popupContentRow = null;
    this.topBarContentRow = null;
    this.settings = null;
    this.builder = null;
  }
}
