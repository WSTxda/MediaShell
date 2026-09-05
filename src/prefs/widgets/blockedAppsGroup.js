/**
 * @file blockedAppsGroup.js
 * @module prefs.widgets.blockedAppsGroup
 *
 * Custom preferences group that displays and edits the blocked-app list.
 *
 * The widget owns the visible rows for blocked desktop IDs and opens
 * BlockedAppChooserDialog when the user adds a new entry. It exposes the final
 * string list through its property; OthersPageController owns the GSettings write.
 */

import Adw from "gi://Adw";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import { gettext as _ } from "../translations.js";

import { GTypeNames } from "../../shared/gobject.js";
import { ResourceUris } from "../../shared/resources.js";
import { createLogger } from "../../shared/logging/logger.js";
import { normalizeUniqueStrings } from "../../shared/format.js";
import {
  createFallbackAppIcon,
  getAppIcon,
  getAppId,
  getAppName,
  listInstalledApps,
} from "../apps/installedAppCatalog.js";
import { PreferencesStyleClasses } from "../ui/style.js";
import BlockedAppChooserDialog from "./blockedAppChooserDialog.js";

const logger = createLogger("BlockedAppsGroup");

/**
 * Custom preferences group that displays and edits the blocked-app list.
 */
class BlockedAppsGroup extends Adw.PreferencesGroup {
  blockedAppIds = [];

  constructor(params = {}) {
    super(params);
    this.listBox = this._lb_blocked_apps;
    this.addButton = this._btn_add;
    this.fallbackAppIcon = createFallbackAppIcon();
    this.chooseBlockedAppPromise = null;
    this.activeChooser = null;
    this.addButton.connect("clicked", () => this.chooseAndAddBlockedApp());
  }

  setBlockedAppIds(blockedAppIds) {
    this.blockedAppIds = normalizeUniqueStrings(blockedAppIds);
    this.render();
  }

  chooseAndAddBlockedApp() {
    if (!this.addButton) return null;
    if (this.chooseBlockedAppPromise) return this.chooseBlockedAppPromise;

    const addButton = this.addButton;
    addButton.sensitive = false;
    const choosePromise = this.performChooseAndAddBlockedApp().finally(() => {
      if (this.chooseBlockedAppPromise === choosePromise)
        this.chooseBlockedAppPromise = null;
      if (this.addButton === addButton) addButton.sensitive = true;
    });
    this.chooseBlockedAppPromise = choosePromise;
    return choosePromise;
  }

  async performChooseAndAddBlockedApp() {
    try {
      const blockedAppChooser = new BlockedAppChooserDialog({
        blockedAppIds: this.blockedAppIds,
      });
      this.activeChooser = blockedAppChooser;
      const appId = await blockedAppChooser.chooseAppId(this.get_root());
      if (this.activeChooser !== blockedAppChooser) return;
      this.activeChooser = null;
      if (!appId || this.blockedAppIds.includes(appId)) return;

      this.blockedAppIds = [appId, ...this.blockedAppIds];
      this.notify("blocked-app-ids");
      this.render();
    } catch (error) {
      if (this.activeChooser) logger.warn("Failed to choose an app", error);
    } finally {
      this.activeChooser = null;
    }
  }

  render() {
    this.listBox.remove_all();
    if (this.blockedAppIds.length === 0) {
      const row = new Adw.ActionRow();
      const emptyState = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        halign: Gtk.Align.CENTER,
        margin_top: 16,
        margin_bottom: 16,
      });
      const icon = new Gtk.Image({
        icon_name: "action-unavailable-symbolic",
        pixel_size: 32,
      });
      icon.add_css_class(PreferencesStyleClasses.DIMMED);
      const label = new Gtk.Label({
        label: _("No apps are blocked"),
        halign: Gtk.Align.CENTER,
      });
      label.add_css_class(PreferencesStyleClasses.DIMMED);
      label.add_css_class(PreferencesStyleClasses.CAPTION);
      emptyState.append(icon);
      emptyState.append(label);
      row.set_child(emptyState);
      this.listBox.append(row);
      return;
    }

    const appsById = new Map(
      listInstalledApps().map((app) => [getAppId(app), app]),
    );

    for (const appId of this.blockedAppIds) {
      const app = appsById.get(appId) ?? null;
      const row = new Adw.ActionRow({
        title: getAppName(app, appId),
        subtitle: app ? appId : null,
      });
      row.add_prefix(
        new Gtk.Image({
          gicon: getAppIcon(app, this.fallbackAppIcon),
          icon_size: Gtk.IconSize.LARGE,
          use_fallback: true,
        }),
      );

      const removeLabel = _("Remove");
      const removeButton = new Gtk.Button({
        icon_name: "user-trash-symbolic",
        tooltip_text: removeLabel,
        has_frame: false,
        valign: Gtk.Align.CENTER,
      });
      removeButton.update_property(
        [Gtk.AccessibleProperty.LABEL],
        [removeLabel],
      );
      removeButton.connect("clicked", () => {
        this.blockedAppIds = this.blockedAppIds.filter((id) => id !== appId);
        this.notify("blocked-app-ids");
        this.render();
      });
      row.add_suffix(removeButton);
      this.listBox.append(row);
    }
  }

  destroy() {
    if (!this.addButton) return;

    const activeChooser = this.activeChooser;
    this.activeChooser = null;
    activeChooser?.force_close();
    this.chooseBlockedAppPromise = null;
    this.blockedAppIds = [];
    this.fallbackAppIcon = null;
    this.addButton = null;
    this.listBox = null;
  }
}

export default GObject.registerClass(
  {
    GTypeName: GTypeNames.BLOCKED_APPS_GROUP,
    Template: ResourceUris.BLOCKED_APPS_UI,
    InternalChildren: ["lb-blocked-apps", "btn-add"],
    Properties: {
      "blocked-app-ids": GObject.ParamSpec.jsobject(
        "blocked-app-ids",
        "Blocked app IDs",
        "Desktop app IDs ignored by the extension",
        GObject.ParamFlags.READABLE,
      ),
    },
  },
  BlockedAppsGroup,
);
