/**
 * @file BlockedAppChooserDialog.js
 * @module prefs.widgets.BlockedAppChooserDialog
 *
 * Presents a searchable dialog for selecting installed apps to block.
 *
 * The dialog owns the temporary selection state, search filtering, and AppInfo
 * monitor refresh source used while the chooser is open. It returns one selected
 * desktop app to BlockedAppsGroup without writing settings itself.
 */

import Adw from "gi://Adw";

import { LARGE_DIALOG_HEIGHT, LARGE_DIALOG_WIDTH, SEARCH_DELAY_MS } from "../constants/layout.js";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import { gettext as _ } from "../PreferencesTranslations.js";

import {
    buildSearchIndex,
    matchesSearchTokens,
    tokenizeSearchQuery,
} from "../../shared/utils/search.js";
import { getAppIcon, getAppId, getAppName, listInstalledApps } from "../utils/InstalledAppCatalog.js";

/**
 * Presents a searchable dialog for selecting installed apps to block.
 */
class BlockedAppChooserDialog extends Adw.Dialog {
    _init(params = {}) {
        const { excludedAppIds = [], ...dialogParams } = params;
        super._init({
            title: _("Select an app to block"),
            content_width: LARGE_DIALOG_WIDTH,
            content_height: LARGE_DIALOG_HEIGHT,
            ...dialogParams,
        });

        this.excludedAppIds = new Set(excludedAppIds);
        this.selectionResolver = null;
        this.selectionPromise = null;
        this.appInfoMonitor = Gio.AppInfoMonitor.get();
        this.appInfoMonitorSignalId = null;
        this.appsRefreshSourceId = null;
        this.searchTokens = [];
        this.appIdByRow = new WeakMap();
        this.searchIndexByRow = new WeakMap();
        this.isClosed = false;

        const toolbarView = new Adw.ToolbarView();
        const headerBar = new Adw.HeaderBar({
            show_start_title_buttons: false,
            show_end_title_buttons: false,
        });
        this.cancelButton = new Gtk.Button({ label: _("Cancel") });
        this.searchButton = new Gtk.ToggleButton({
            icon_name: "system-search-symbolic",
            tooltip_text: _("Search apps"),
        });
        this.selectButton = new Gtk.Button({
            label: _("Select"),
            sensitive: false,
        });
        this.selectButton.add_css_class("suggested-action");

        const endActions = new Gtk.Box({ spacing: 6 });
        endActions.append(this.searchButton);
        endActions.append(this.selectButton);
        headerBar.pack_start(this.cancelButton);
        headerBar.pack_end(endActions);
        toolbarView.add_top_bar(headerBar);

        this.searchEntry = new Gtk.SearchEntry({
            placeholder_text: _("Search apps"),
            search_delay: SEARCH_DELAY_MS,
            hexpand: true,
        });
        this.searchBar = new Gtk.SearchBar({
            search_mode_enabled: false,
            show_close_button: false,
            child: this.searchEntry,
        });
        this.searchBar.connect_entry(this.searchEntry);
        toolbarView.add_top_bar(this.searchBar);

        this.listBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.SINGLE,
            margin_start: 12,
            margin_end: 12,
            margin_bottom: 12,
        });
        this.listBox.add_css_class("boxed-list");
        const emptyLabel = new Gtk.Label({
            label: _("No apps found"),
            margin_top: 24,
            margin_bottom: 24,
        });
        emptyLabel.add_css_class("dim-label");
        this.listBox.set_placeholder(emptyLabel);
        this.listBox.set_filter_func((row) => this.matchesSearch(row));

        const scrolledWindow = new Gtk.ScrolledWindow({
            vexpand: true,
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            child: this.listBox,
        });
        toolbarView.set_content(scrolledWindow);
        this.set_child(toolbarView);
        this.searchBar.set_key_capture_widget(this);
        this.default_widget = this.selectButton;

        this.populateApps();
        this.searchEntry.connect("search-changed", () => this.updateFilter());
        this.searchEntry.connect("stop-search", () => this.setSearchMode(false));
        this.searchButton.connect("toggled", () => this.setSearchMode(this.searchButton.active));
        this.searchBar.connect("notify::search-mode-enabled", () => {
            const searchModeEnabled = this.searchBar.search_mode_enabled;
            if (this.searchButton.active !== searchModeEnabled) this.searchButton.active = searchModeEnabled;
            if (!searchModeEnabled) this.searchEntry.text = "";
        });
        this.listBox.connect("row-selected", (_listBox, row) => {
            this.selectButton.sensitive = row !== null;
        });
        this.listBox.connect("row-activated", (_listBox, row) => this.listBox.select_row(row));
        this.selectButton.connect("clicked", () => this.confirmSelection());
        this.cancelButton.connect("clicked", () => this.close());
        this.appInfoMonitorSignalId = this.appInfoMonitor.connect("changed", () => this.scheduleAppsRefresh());
        this.connect("closed", () => this.handleClosed());
    }

    setSearchMode(searchModeEnabled) {
        if (this.searchBar.search_mode_enabled !== searchModeEnabled)
            this.searchBar.search_mode_enabled = searchModeEnabled;
        if (searchModeEnabled) this.searchEntry.grab_focus();
    }

    populateApps() {
        const selectedAppId = this.getAppIdFromRow(this.listBox.get_selected_row()) || null;
        this.listBox.remove_all();
        this.appIdByRow = new WeakMap();
        this.searchIndexByRow = new WeakMap();

        // Blocked-app selection must include every registered desktop app, not
        // only entries that should be shown in the current desktop menu. MPRIS
        // endpoints can legitimately reference NoDisplay or desktop-filtered
        // launchers, and those apps still need to be blockable.
        const installedApps = listInstalledApps()
            .filter((app) => !this.excludedAppIds.has(getAppId(app)))
            .sort((first, second) => getAppName(first).localeCompare(getAppName(second)));

        let selectedRow = null;
        for (const app of installedApps) {
            const appId = getAppId(app);
            const appName = getAppName(app, appId);
            const row = new Adw.ActionRow({
                title: appName,
                subtitle: appId,
                activatable: true,
            });
            row.add_prefix(
                new Gtk.Image({
                    gicon: getAppIcon(app),
                    pixel_size: 32,
                    use_fallback: true,
                }),
            );
            this.appIdByRow.set(row, appId);
            this.searchIndexByRow.set(row, buildSearchIndex([appName, appId]));
            this.listBox.append(row);
            if (appId === selectedAppId) selectedRow = row;
        }

        this.listBox.invalidate_filter();
        if (selectedRow && this.matchesSearch(selectedRow)) this.listBox.select_row(selectedRow);
        else this.listBox.unselect_all();
        this.selectButton.sensitive = this.listBox.get_selected_row() !== null;
    }

    scheduleAppsRefresh() {
        if (this.isClosed || this.appsRefreshSourceId !== null) return;

        this.appsRefreshSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.appsRefreshSourceId = null;
            if (!this.isClosed) this.populateApps();
            return GLib.SOURCE_REMOVE;
        });
    }

    getActionRow(row) {
        if (!row) return null;
        if (typeof row.title === "string" || typeof row.subtitle === "string") return row;
        return row.get_child?.() ?? null;
    }

    getAppIdFromRow(row) {
        if (!row) return "";
        return this.appIdByRow.get(row) ?? String(this.getActionRow(row)?.subtitle ?? "");
    }

    matchesSearch(row) {
        if (!row) return false;
        const actionRow = this.getActionRow(row);
        let searchIndex = this.searchIndexByRow.get(row);
        if (searchIndex === undefined) {
            searchIndex = buildSearchIndex([actionRow?.title, actionRow?.subtitle]);
            this.searchIndexByRow.set(row, searchIndex);
        }
        return matchesSearchTokens(this.searchTokens, searchIndex);
    }

    updateFilter() {
        this.searchTokens = tokenizeSearchQuery(this.searchEntry.text);
        const selectedRow = this.listBox.get_selected_row();
        this.listBox.invalidate_filter();
        if (selectedRow && !this.matchesSearch(selectedRow)) this.listBox.unselect_all();
    }

    confirmSelection() {
        const selectedRow = this.listBox.get_selected_row();
        if (!selectedRow) return;

        this.finishSelection(this.getAppIdFromRow(selectedRow) || null);
        this.close();
    }

    finishSelection(appId) {
        const resolve = this.selectionResolver;
        if (!resolve) return;
        this.selectionResolver = null;
        this.selectionPromise = null;
        resolve(appId);
    }

    handleClosed() {
        if (this.isClosed) return;
        this.isClosed = true;

        this.searchBar.set_key_capture_widget(null);
        if (this.appsRefreshSourceId !== null) {
            GLib.Source.remove(this.appsRefreshSourceId);
            this.appsRefreshSourceId = null;
        }
        if (this.appInfoMonitorSignalId !== null) {
            this.appInfoMonitor.disconnect(this.appInfoMonitorSignalId);
            this.appInfoMonitorSignalId = null;
        }
        this.appInfoMonitor = null;
        this.searchTokens = [];
        this.appIdByRow = new WeakMap();
        this.searchIndexByRow = new WeakMap();
        this.finishSelection(null);
    }

    chooseAppId(parent) {
        if (this.selectionPromise) return this.selectionPromise;

        this.selectionPromise = new Promise((resolve) => {
            this.selectionResolver = resolve;
        });
        this.present(parent);
        return this.selectionPromise;
    }
}

export default GObject.registerClass({ GTypeName: "MediaShellBlockedAppChooserDialog" }, BlockedAppChooserDialog);
