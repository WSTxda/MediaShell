/**
 * @file interactionsPageController.js
 * @module prefs.controllers.interactionsPageController
 *
 * Drives the interactions shortcut editor page in the preferences window.
 *
 * The controller validates accelerator input, writes accepted shortcuts to
 * GSettings, and restores the previous value when the user cancels or enters an
 * invalid shortcut. It is preferences-only and never registers global keybindings.
 *
 * @see src/shell/services/globalShortcutsService.js
 */

import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";

import {
  INPUT_ACTION_DEFINITIONS,
  KEYBOARD_SHORTCUT_KEYS,
} from "../../shared/input/actions.js";
import { gettext as _ } from "../translations.js";
import {
  LARGE_DIALOG_HEIGHT,
  LARGE_DIALOG_WIDTH,
  SHORTCUT_DIALOG_WIDTH,
  TOAST_TIMEOUT_SECONDS,
} from "../constants/preferencesUi.js";
import { PreferencesStyleClasses } from "../constants/styleClasses.js";
import {
  connectOwnedSignal,
  disconnectOwnedSignals,
} from "../utils/signalConnections.js";
import {
  isValidAccelerator,
  isValidBinding,
} from "../utils/shortcutValidation.js";

const SHORTCUT_SECTION_ORDER = Object.freeze([
  "playback",
  "audio",
  "interface",
  "apps",
]);

function createActionCopy() {
  return Object.freeze({
    "toggle-shuffle": Object.freeze({
      title: _("Shuffle"),
      section: "playback",
    }),
    "seek-backward": Object.freeze({
      title: _("Seek backward"),
      section: "playback",
    }),
    "previous-track": Object.freeze({
      title: _("Previous track"),
      section: "playback",
    }),
    "play-pause": Object.freeze({
      title: _("Play / pause"),
      section: "playback",
    }),
    "next-track": Object.freeze({
      title: _("Next track"),
      section: "playback",
    }),
    "seek-forward": Object.freeze({
      title: _("Seek forward"),
      section: "playback",
    }),
    "toggle-loop": Object.freeze({ title: _("Repeat"), section: "playback" }),
    "volume-up": Object.freeze({ title: _("Volume up"), section: "audio" }),
    "volume-down": Object.freeze({ title: _("Volume down"), section: "audio" }),
    "toggle-popup": Object.freeze({ title: _("Popup"), section: "interface" }),
    "open-preferences": Object.freeze({
      title: _("Preferences"),
      section: "interface",
    }),
    "raise-app": Object.freeze({
      title: _("Open app"),
      section: "apps",
    }),
    "quit-app": Object.freeze({ title: _("Quit app"), section: "apps" }),
    "switch-app": Object.freeze({ title: _("Switch app"), section: "apps" }),
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

      const resetButton = new Gtk.Button({
        icon_name: "edit-clear-symbolic",
        tooltip_text: _("Reset"),
        has_frame: false,
        valign: Gtk.Align.CENTER,
      });
      row.add_suffix(resetButton);

      const updateResetButtonVisibility = () => {
        resetButton.visible = Boolean(
          this.settings.get_strv(definition.shortcutKey)[0] ?? "",
        );
      };

      this.connectOwnedSignal(row, "activated", () =>
        this.presentShortcutEditor(definition),
      );
      this.connectOwnedSignal(resetButton, "clicked", () =>
        this.resetShortcut(definition),
      );
      this.connectOwnedSignal(
        this.settings,
        `changed::${definition.shortcutKey}`,
        updateResetButtonVisibility,
      );
      updateResetButtonVisibility();
    }

    this.connectOwnedSignal(this.shortcutOverviewButton, "clicked", () =>
      this.presentShortcutsOverview(),
    );
    this.connectOwnedSignal(this.resetShortcutsRow, "activated", () =>
      this.presentResetShortcutsConfirmation(),
    );
  }

  presentShortcutEditor(definition) {
    if (!this.preferencesWindow) return;

    this.dismissActiveShortcutEditor();

    const dialog = new Adw.Dialog({
      title: this.actionCopy[definition.id].title,
      content_width: SHORTCUT_DIALOG_WIDTH,
      content_height: 240,
    });
    const toolbarView = new Adw.ToolbarView();
    const headerBar = new Adw.HeaderBar({
      show_start_title_buttons: false,
      show_end_title_buttons: false,
    });
    const cancelButton = new Gtk.Button({ label: _("Cancel") });
    const confirmButton = new Gtk.Button({
      label: _("Set"),
      sensitive: false,
    });
    confirmButton.add_css_class(PreferencesStyleClasses.SUGGESTED_ACTION);

    headerBar.pack_start(cancelButton);
    headerBar.pack_end(confirmButton);
    toolbarView.add_top_bar(headerBar);
    dialog.default_widget = confirmButton;

    const captureBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 20,
      margin_start: 24,
      margin_end: 24,
      margin_top: 24,
      margin_bottom: 24,
      focusable: true,
    });
    const promptLabel = new Gtk.Label({
      label: _("Press a shortcut"),
      halign: Gtk.Align.CENTER,
    });
    promptLabel.add_css_class("title-3");
    captureBox.append(promptLabel);

    const shortcutLabel = new Gtk.ShortcutLabel({
      accelerator: "",
      disabled_text: _("Not set"),
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
    });
    const shortcutIcon = new Gtk.Image({
      icon_name: "preferences-desktop-keyboard-shortcuts-symbolic",
      pixel_size: 64,
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
    });
    const inputStack = new Gtk.Stack({
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
      vexpand: true,
      transition_type: Gtk.StackTransitionType.CROSSFADE,
    });
    inputStack.add_named(shortcutIcon, "prompt");
    inputStack.add_named(shortcutLabel, "shortcut");
    inputStack.set_visible_child_name("prompt");
    captureBox.append(inputStack);
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
      inputStack,
      keyController,
      confirmButton,
      pendingAccelerator: null,
      keyPressedSignalId: 0,
      cleanedUp: false,
    };
    this.activeEditorSession = session;
    cancelButton.connect("clicked", () => dialog.close());
    confirmButton.connect("clicked", () => this.saveShortcut(session));
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
    if (this.activeEditorSession !== session) return Gdk.EVENT_STOP;

    let mask = state & Gtk.accelerator_get_default_mod_mask();
    mask &= ~Gdk.ModifierType.LOCK_MASK;

    if (
      !mask &&
      (keyval === Gdk.KEY_Escape ||
        keyval === Gdk.KEY_Return ||
        keyval === Gdk.KEY_KP_Enter)
    ) {
      return Gdk.EVENT_PROPAGATE;
    }

    if (!mask && keyval === Gdk.KEY_BackSpace) return Gdk.EVENT_STOP;

    if (
      isValidBinding(mask, keycode, keyval) &&
      isValidAccelerator(mask, keyval)
    ) {
      this.setShortcutSelection(
        session,
        Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask),
      );
    }
    return Gdk.EVENT_STOP;
  }

  setShortcutSelection(session, accelerator) {
    if (this.activeEditorSession !== session) return;

    session.pendingAccelerator = accelerator;
    session.shortcutLabel.accelerator = accelerator;
    session.inputStack.set_visible_child_name("shortcut");
    session.confirmButton.sensitive = true;
  }

  resetShortcut(definition) {
    this.settings.reset(definition.shortcutKey);
  }

  saveShortcut(session) {
    if (this.activeEditorSession !== session) return;
    if (session.pendingAccelerator === null) return;

    const shortcut = session.pendingAccelerator;
    const conflictingDefinition = INPUT_ACTION_DEFINITIONS.find(
      ({ shortcutKey }) =>
        shortcutKey !== session.definition.shortcutKey &&
        (this.settings.get_strv(shortcutKey)[0] ?? "") === shortcut,
    );
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
    if (!this.preferencesWindow) return;

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

    for (const sectionId of SHORTCUT_SECTION_ORDER) {
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
    if (!this.preferencesWindow) return;

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
      if (this.resetConfirmationDialog !== dialog) return;
      this.resetConfirmationDialog = null;
      if (response === "reset") this.resetKeyboardShortcuts();
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
    if (!this.preferencesWindow) return;
    this.preferencesWindow = null;

    this.dismissActiveShortcutEditor();

    const shortcutsOverviewDialog = this.shortcutsOverviewDialog;
    this.shortcutsOverviewDialog = null;
    shortcutsOverviewDialog?.force_close();

    const resetConfirmationDialog = this.resetConfirmationDialog;
    this.resetConfirmationDialog = null;
    resetConfirmationDialog?.force_close();

    disconnectOwnedSignals(this.ownedSignalConnections);
    this.overviewShortcutLabels.clear();
    this.activeEditorSession = null;
    this.shortcutOverviewButton = null;
    this.resetShortcutsRow = null;
    this.actionCopy = null;
    this.sectionCopy = null;
    this.settings = null;
    this.builder = null;
  }
}
