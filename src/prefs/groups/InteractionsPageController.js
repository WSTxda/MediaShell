/**
 * @file InteractionsPageController.js
 * @module prefs.groups.InteractionsPageController
 *
 * Drives the interactions shortcut editor page in the preferences window.
 *
 * The controller validates accelerator input, writes accepted shortcuts to
 * GSettings, and restores the previous value when the user cancels or enters an
 * invalid shortcut. It is preferences-only and never registers global keybindings.
 *
 * @see src/shell/services/GlobalShortcutsService.js
 */

import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";

import {
  INPUT_ACTION_DEFINITIONS,
  KEYBOARD_SHORTCUT_KEYS,
} from "../../shared/constants/inputActions.js";
import { createLogger } from "../../shared/utils/log.js";
import { gettext as _ } from "../PreferencesTranslations.js";
import {
  LARGE_DIALOG_HEIGHT,
  LARGE_DIALOG_WIDTH,
  SHORTCUT_DIALOG_WIDTH,
  TOAST_TIMEOUT_SECONDS,
} from "../constants/layout.js";
import {
  connectOwnedSignal,
  disconnectOwnedSignals,
} from "../utils/SignalConnections.js";
import {
  isValidAccelerator,
  isValidBinding,
} from "../utils/ShortcutValidation.js";

const logger = createLogger("InteractionsPageController");
const SECTION_ORDER = Object.freeze(["playback", "audio", "apps", "interface"]);

function createActionCopy() {
  return Object.freeze({
    "play-pause": Object.freeze({
      title: _("Play / pause"),
      section: "playback",
    }),
    "next-track": Object.freeze({
      title: _("Next track"),
      section: "playback",
    }),
    "previous-track": Object.freeze({
      title: _("Previous track"),
      section: "playback",
    }),
    "volume-up": Object.freeze({ title: _("Volume up"), section: "audio" }),
    "volume-down": Object.freeze({ title: _("Volume down"), section: "audio" }),
    "toggle-loop": Object.freeze({ title: _("Repeat"), section: "playback" }),
    "toggle-shuffle": Object.freeze({
      title: _("Shuffle"),
      section: "playback",
    }),
    "toggle-popup": Object.freeze({ title: _("Popup"), section: "interface" }),
    "raise-app": Object.freeze({ title: _("Open app"), section: "apps" }),
    "quit-app": Object.freeze({ title: _("Quit app"), section: "apps" }),
    "open-preferences": Object.freeze({
      title: _("Preferences"),
      section: "interface",
    }),
    "next-app": Object.freeze({ title: _("Next app"), section: "apps" }),
  });
}

function createSectionCopy() {
  return Object.freeze({
    playback: _("Playback"),
    audio: _("Audio"),
    apps: _("Apps"),
    interface: _("Interface"),
  });
}

function shortcutRowId(actionId) {
  return `ar-interactions-shortcut-${actionId}`;
}

/**
 * Drives the interactions shortcut editor page in the preferences window.
 */
export default class InteractionsPageController {
  constructor(settings, builder, preferencesWindow) {
    this.settings = settings;
    this.builder = builder;
    this.preferencesWindow = preferencesWindow;
    this.ownedSignalConnections = [];
    this.actionCopy = null;
    this.sectionCopy = null;
    this.activeEditorSession = null;
    this.shortcutsOverviewDialog = null;
    this.overviewShortcutLabels = new Map();
    this.resetConfirmationDialog = null;
    this.isDestroyed = false;
  }

  init() {
    this.actionCopy = createActionCopy();
    this.sectionCopy = createSectionCopy();
    this.shortcutOverviewButton = this.builder.get_object(
      "btn-interactions-shortcut-overview",
    );
    this.resetShortcutsRow = this.builder.get_object(
      "br-interactions-reset-shortcuts",
    );

    for (const definition of INPUT_ACTION_DEFINITIONS) {
      const row = this.builder.get_object(shortcutRowId(definition.id));
      if (!row)
        throw new Error(`Shortcut preference row not found: ${definition.id}`);
      this.connectOwnedSignal(row, "activated", () =>
        this.presentShortcutEditor(definition),
      );
    }

    this.connectOwnedSignal(this.shortcutOverviewButton, "clicked", () =>
      this.presentShortcutsOverview(),
    );
    this.connectOwnedSignal(this.resetShortcutsRow, "activated", () =>
      this.presentResetShortcutsConfirmation(),
    );
  }

  presentShortcutEditor(definition) {
    if (this.isDestroyed) return;

    this.dismissActiveShortcutEditor();

    const dialog = new Adw.Dialog({
      title: this.actionCopy[definition.id].title,
      content_width: SHORTCUT_DIALOG_WIDTH,
      content_height: 240,
    });
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(new Adw.HeaderBar());

    const captureBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 20,
      margin_start: 24,
      margin_end: 24,
      margin_top: 24,
      margin_bottom: 24,
      focusable: true,
    });
    captureBox.append(
      new Gtk.Label({
        label: _(
          "Press Escape to cancel.\nPress Enter to save.\nPress Backspace to clear the shortcut.",
        ),
        wrap: true,
      }),
    );

    const shortcutLabel = new Gtk.ShortcutLabel({
      accelerator: this.settings.get_strv(definition.shortcutKey)[0] ?? "",
      disabled_text: _("Press a shortcut"),
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
      vexpand: true,
    });
    captureBox.append(shortcutLabel);
    toolbarView.set_content(captureBox);
    dialog.set_child(toolbarView);

    const keyController = new Gtk.EventControllerKey({
      propagation_phase: Gtk.PropagationPhase.CAPTURE,
    });
    dialog.add_controller(keyController);

    const session = {
      definition,
      dialog,
      shortcutLabel,
      captureBox,
      keyController,
      keyPressedSignalId: 0,
      cleanedUp: false,
    };
    this.activeEditorSession = session;
    session.keyPressedSignalId = keyController.connect(
      "key-pressed",
      (_controller, keyval, keycode, state) =>
        this.handleShortcutKeyPressed(session, keyval, keycode, state),
    );
    dialog.connect("closed", () => this.cleanupShortcutEditorSession(session));

    dialog.present(this.preferencesWindow);
    captureBox.grab_focus();
  }

  cleanupShortcutEditorSession(session) {
    if (!session || session.cleanedUp) return;

    session.cleanedUp = true;
    session.keyController.disconnect(session.keyPressedSignalId);
    session.dialog.remove_controller(session.keyController);
    if (this.activeEditorSession === session) this.activeEditorSession = null;
  }

  dismissActiveShortcutEditor() {
    const session = this.activeEditorSession;
    if (!session) return;

    this.cleanupShortcutEditorSession(session);
    session.dialog.force_close();
  }

  handleShortcutKeyPressed(session, keyval, keycode, state) {
    if (this.isDestroyed || this.activeEditorSession !== session)
      return Gdk.EVENT_STOP;

    let mask = state & Gtk.accelerator_get_default_mod_mask();
    mask &= ~Gdk.ModifierType.LOCK_MASK;

    if (!mask && keyval === Gdk.KEY_Escape) {
      session.dialog.close();
      return Gdk.EVENT_STOP;
    }

    if (!mask && keyval === Gdk.KEY_BackSpace) {
      session.shortcutLabel.accelerator = "";
      return Gdk.EVENT_STOP;
    }

    if (!mask && (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter)) {
      this.saveShortcut(session);
      return Gdk.EVENT_STOP;
    }

    if (
      isValidBinding(mask, keycode, keyval) &&
      isValidAccelerator(mask, keyval)
    ) {
      session.shortcutLabel.accelerator = Gtk.accelerator_name_with_keycode(
        null,
        keyval,
        keycode,
        mask,
      );
    }
    return Gdk.EVENT_STOP;
  }

  saveShortcut(session) {
    if (this.isDestroyed || this.activeEditorSession !== session) return;

    const shortcut = session.shortcutLabel.accelerator;
    const conflictingDefinition = shortcut
      ? INPUT_ACTION_DEFINITIONS.find(
          ({ shortcutKey }) =>
            shortcutKey !== session.definition.shortcutKey &&
            (this.settings.get_strv(shortcutKey)[0] ?? "") === shortcut,
        )
      : null;
    if (conflictingDefinition) {
      this.preferencesWindow.add_toast(
        new Adw.Toast({
          title: _("Shortcut already used by %s").format(
            this.actionCopy[conflictingDefinition.id].title,
          ),
          timeout: TOAST_TIMEOUT_SECONDS,
        }),
      );
      return;
    }

    this.settings.set_strv(session.definition.shortcutKey, [shortcut]);
    session.dialog.close();
  }

  presentShortcutsOverview() {
    if (this.isDestroyed) return;

    this.shortcutsOverviewDialog?.force_close();
    this.overviewShortcutLabels.clear();

    const dialog = new Adw.Dialog({
      title: _("Keyboard shortcuts"),
      content_width: LARGE_DIALOG_WIDTH,
      content_height: LARGE_DIALOG_HEIGHT,
    });
    const toolbarView = new Adw.ToolbarView();
    toolbarView.add_top_bar(new Adw.HeaderBar());
    const page = new Adw.PreferencesPage();

    for (const sectionId of SECTION_ORDER) {
      const group = new Adw.PreferencesGroup({
        title: this.sectionCopy[sectionId],
      });
      for (const definition of INPUT_ACTION_DEFINITIONS.filter(
        ({ id }) => this.actionCopy[id].section === sectionId,
      )) {
        const accelerator =
          this.settings.get_strv(definition.shortcutKey)[0] ?? "";
        const row = new Adw.ActionRow({
          title: this.actionCopy[definition.id].title,
          activatable: false,
        });
        const shortcutLabel = new Gtk.ShortcutLabel({
          accelerator,
          disabled_text: _("Not set"),
          valign: Gtk.Align.CENTER,
        });
        row.add_suffix(shortcutLabel);
        group.add(row);
        this.overviewShortcutLabels.set(definition.shortcutKey, shortcutLabel);
      }
      page.add(group);
    }

    toolbarView.set_content(page);
    dialog.set_child(toolbarView);
    this.shortcutsOverviewDialog = dialog;
    dialog.connect("closed", () => {
      if (this.shortcutsOverviewDialog === dialog) {
        this.shortcutsOverviewDialog = null;
        this.overviewShortcutLabels.clear();
      }
    });
    dialog.present(this.preferencesWindow);
  }

  presentResetShortcutsConfirmation(parent = this.preferencesWindow) {
    if (this.isDestroyed) return;

    this.resetConfirmationDialog?.force_close();

    const dialog = new Adw.AlertDialog({
      heading: _("Reset keyboard shortcuts?"),
      body: _("Every keyboard shortcut will be disabled."),
    });
    this.resetConfirmationDialog = dialog;
    dialog.add_response("cancel", _("Cancel"));
    dialog.add_response("reset", _("Reset"));
    dialog.set_response_appearance("reset", Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.default_response = "cancel";
    dialog.close_response = "cancel";
    dialog.connect("response", (_dialog, response) => {
      if (response === "reset") this.resetKeyboardShortcuts();
      if (this.resetConfirmationDialog === dialog)
        this.resetConfirmationDialog = null;
    });
    dialog.present(parent);
  }

  resetKeyboardShortcuts() {
    for (const shortcutKey of KEYBOARD_SHORTCUT_KEYS)
      this.settings.reset(shortcutKey);
    for (const shortcutLabel of this.overviewShortcutLabels.values())
      shortcutLabel.accelerator = "";
    this.preferencesWindow.add_toast(
      new Adw.Toast({
        title: _("Keyboard shortcuts reset"),
        timeout: TOAST_TIMEOUT_SECONDS,
      }),
    );
  }

  connectOwnedSignal(object, signal, callback) {
    connectOwnedSignal(this.ownedSignalConnections, object, signal, callback);
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    this.dismissActiveShortcutEditor();
    this.shortcutsOverviewDialog?.force_close();
    this.resetConfirmationDialog?.force_close();

    disconnectOwnedSignals(this.ownedSignalConnections, (error) => {
      logger.debug(
        "A keyboard shortcut signal was already disconnected",
        error,
      );
    });
    this.overviewShortcutLabels.clear();
    this.activeEditorSession = null;
    this.shortcutsOverviewDialog = null;
    this.resetConfirmationDialog = null;
    this.shortcutOverviewButton = null;
    this.resetShortcutsRow = null;
    this.actionCopy = null;
    this.sectionCopy = null;
    this.settings = null;
    this.builder = null;
    this.preferencesWindow = null;
  }
}
