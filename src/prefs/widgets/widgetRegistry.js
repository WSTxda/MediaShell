/**
 * @file widgetRegistry.js
 * @module prefs.widgets.widgetRegistry
 *
 * Registers the custom GObject preference widgets before GtkBuilder loads templates.
 *
 * PreferencesController calls this module once so template class names such as
 * MediaShellBlockedAppsGroup resolve correctly in the UI definition. The registry
 * owns no widget instances; it only guarantees type registration.
 */

import GObject from "gi://GObject";

import BlockedAppsGroup from "./BlockedAppsGroup.js";
import TrackInformationContentRow from "./TrackInformationContentRow.js";
import TopBarElementOrderGroup from "./TopBarElementOrderGroup.js";

export function ensurePreferenceWidgetsRegistered() {
  GObject.type_ensure(BlockedAppsGroup.$gtype);
  GObject.type_ensure(TrackInformationContentRow.$gtype);
  GObject.type_ensure(TopBarElementOrderGroup.$gtype);
}
