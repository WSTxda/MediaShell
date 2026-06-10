// Ensures custom GObject widget types are registered before Gtk.Builder loads templates.
import GObject from "gi://GObject";

import BlockedAppsGroup from "./BlockedAppsGroup.js";
import TopBarTrackInformationContentRow from "./TopBarTrackInformationContentRow.js";
import TopBarElementOrderGroup from "./TopBarElementOrderGroup.js";

export function ensurePreferenceWidgetsRegistered() {
    GObject.type_ensure(BlockedAppsGroup.$gtype);
    GObject.type_ensure(TopBarTrackInformationContentRow.$gtype);
    GObject.type_ensure(TopBarElementOrderGroup.$gtype);
}
