/**
 * @file BlockedAppsGroup.js
 * @module prefs.widgets.BlockedAppsGroup
 *
 * Custom preferences group that displays and edits the blocked-app list.
 *
 * The widget owns the visible rows for blocked desktop IDs and opens
 * BlockedAppChooserDialog when the user adds a new entry. It writes the final
 * string list to GSettings through the settings object passed by its controller.
 */

import Adw from "gi://Adw";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import { gettext as _ } from "../translations.js";

import { GTypeNames } from "../../shared/constants/gtypes.js";
import { ResourceUris } from "../../shared/constants/resources.js";
import { createLogger } from "../../shared/utils/log.js";
import { normalizeUniqueStrings } from "../../shared/utils/format.js";
import {
  getAppIcon,
  getAppId,
  getAppName,
  listInstalledApps,
} from "../services/installedAppCatalog.js";
import { PreferencesStyleClasses } from "../constants/styleClasses.js";
import BlockedAppChooserDialog from "./BlockedAppChooserDialog.js";

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
      icon.add_css_class(PreferencesStyleClasses.DIM_LABEL);
      const label = new Gtk.Label({
        label: _("No apps are blocked"),
        halign: Gtk.Align.CENTER,
      });
      label.add_css_class(PreferencesStyleClasses.DIM_LABEL);
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
          gicon: getAppIcon(app),
          icon_size: Gtk.IconSize.LARGE,
          use_fallback: true,
        }),
      );

      const removeButton = new Gtk.Button({ icon_name: "user-trash-symbolic" });
      removeButton.marginTop = 10;
      removeButton.marginBottom = 10;
      removeButton.add_css_class(PreferencesStyleClasses.FLAT);
      removeButton.add_css_class(PreferencesStyleClasses.CIRCULAR);
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
