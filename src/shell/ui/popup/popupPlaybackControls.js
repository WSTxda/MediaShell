/**
 * @file popupPlaybackControls.js
 * @module shell.ui.popup.popupPlaybackControls
 *
 * Renders configurable playback controls inside the popup.
 *
 * PopupContent owns surface visibility. This renderer owns popup actors and
 * delegates state and execution to the shared playback-control domain.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import {
  PlaybackControlContentKinds,
  PlaybackControlGroups,
} from "../../../shared/playback/controls.js";
import { PlaybackControlSurfaces } from "../../../shared/playback/surfaces.js";
import { resolvePlaybackControlState } from "../../media/playback/controlState.js";
import { resolvePlaybackControlSurfaceUpdates } from "../../media/playback/surfaceState.js";
import { PopupPlaybackControlRegions } from "./regions.js";
import {
  ACTIVE_OPACITY,
  INACTIVE_OPACITY,
} from "../../constants/actorState.js";
import {
  POPUP_PRIMARY_PLAYBACK_CONTROL_ORDER,
  POPUP_SECONDARY_PLAYBACK_CONTROL_ORDER,
} from "../../constants/playbackControls.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import { reconcileActorOrder } from "../components/actorOrder.js";
import { updatePlaybackControlButton } from "../components/playback/button.js";
import {
  createPlaybackControlContent,
  updatePlaybackControlContent,
} from "../components/playback/content.js";
import { styleClassNames } from "../../utils/styleClasses.js";

/** Renders configurable playback controls inside the popup. */
export default class PopupPlaybackControls {
  constructor(popupContent, playbackController) {
    this.popupContent = popupContent;
    this.actor = null;
    this.primaryControlsBox = null;
    this.secondaryControlsBox = null;
    this.controlButtons = new Map();
    this.playbackController = playbackController;
  }

  get extensionController() {
    return this.popupContent.extensionController;
  }

  get mediaApp() {
    return this.popupContent.mediaApp;
  }

  render(dirtyRegions) {
    this.ensureActor();
    const updates = resolvePlaybackControlSurfaceUpdates(
      this.extensionController,
      PlaybackControlSurfaces.POPUP,
      PopupPlaybackControlRegions,
      dirtyRegions,
    );
    for (const { controlId, isVisible } of updates)
      this.reconcilePlaybackControl(controlId, isVisible);

    if (this.controlButtons.size === 0) {
      this.remove();
      return;
    }

    this.reconcileOrder();
    this.syncGroupVisibility();
    this.attach();
  }

  ensureActor() {
    if (this.actor) return;

    this.actor = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: StyleClasses.POPUP_PLAYBACK_CONTROLS,
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.primaryControlsBox = new St.BoxLayout({
      styleClass: StyleClasses.POPUP_PRIMARY_CONTROLS,
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.secondaryControlsBox = new St.BoxLayout({
      styleClass: StyleClasses.POPUP_SECONDARY_CONTROLS,
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.actor.add_child(this.primaryControlsBox);
    this.actor.add_child(this.secondaryControlsBox);
  }

  reconcilePlaybackControl(controlId, isVisible) {
    if (!isVisible) {
      this.removePlaybackControl(controlId);
      return;
    }

    const controlState = resolvePlaybackControlState(this.mediaApp, controlId);
    const buttonState = this.ensurePlaybackControl(controlState.control);
    this.syncPlaybackControl(buttonState, controlState);
  }

  ensurePlaybackControl(controlDefinition) {
    let buttonState = this.controlButtons.get(controlDefinition.id);
    if (buttonState) return buttonState;

    const isLabelControl =
      controlDefinition.contentKind === PlaybackControlContentKinds.LABEL;
    const button = new St.Button({
      name: controlDefinition.actorName,
      styleClass: styleClassNames(
        StyleClasses.BUTTON,
        StyleClasses.POPUP_CONTROL_BUTTON,
        controlDefinition.isPrimary
          ? StyleClasses.POPUP_CONTROL_BUTTON_PRIMARY
          : controlDefinition.isAdjacent
            ? StyleClasses.POPUP_CONTROL_BUTTON_ADJACENT
            : isLabelControl
              ? StyleClasses.POPUP_CONTROL_BUTTON_TEXT
              : StyleClasses.POPUP_CONTROL_BUTTON_CIRCULAR,
        controlDefinition.isStateControl
          ? StyleClasses.POPUP_CONTROL_BUTTON_STATE
          : null,
      ),
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
      toggleMode: controlDefinition.isStateControl,
    });
    const content = createPlaybackControlContent(controlDefinition, {
      iconStyleClass: styleClassNames(
        StyleClasses.POPUP_MENU_ICON,
        StyleClasses.POPUP_CONTROL_ICON,
      ),
      labelStyleClass: StyleClasses.POPUP_CONTROL_LABEL,
    });
    buttonState = { button, content, signalId: 0, action: null };
    buttonState.signalId = button.connect("clicked", () => {
      if (!buttonState.button.reactive) return;
      void this.playbackController.execute(buttonState.action, this.mediaApp);
    });
    button.set_child(content.actor);
    this.controlButtons.set(controlDefinition.id, buttonState);
    return buttonState;
  }

  syncPlaybackControl(buttonState, controlState) {
    const {
      control: controlDefinition,
      iconName,
      labelText,
      isReactive,
      action,
    } = controlState;
    const targetBox =
      controlDefinition.group === PlaybackControlGroups.SECONDARY
        ? this.secondaryControlsBox
        : this.primaryControlsBox;

    buttonState.action = action;
    updatePlaybackControlContent(buttonState.content, { iconName, labelText });
    updatePlaybackControlButton(
      buttonState.button,
      this.mediaApp,
      controlState,
      _,
    );
    buttonState.button.opacity = isReactive ? ACTIVE_OPACITY : INACTIVE_OPACITY;

    if (buttonState.button.get_parent() !== targetBox) {
      buttonState.button.get_parent()?.remove_child(buttonState.button);
      targetBox.add_child(buttonState.button);
    }
  }

  reconcileOrder() {
    reconcileActorOrder(
      this.primaryControlsBox,
      POPUP_PRIMARY_PLAYBACK_CONTROL_ORDER.map(
        (controlId) => this.controlButtons.get(controlId)?.button,
      ),
    );
    reconcileActorOrder(
      this.secondaryControlsBox,
      POPUP_SECONDARY_PLAYBACK_CONTROL_ORDER.map(
        (controlId) => this.controlButtons.get(controlId)?.button,
      ),
    );
  }

  syncGroupVisibility() {
    this.primaryControlsBox.visible =
      this.primaryControlsBox.get_n_children() > 0;
    this.secondaryControlsBox.visible =
      this.secondaryControlsBox.get_n_children() > 0;
  }

  removePlaybackControl(controlId) {
    const controlState = this.controlButtons.get(controlId);
    if (!controlState) return;

    controlState.button.disconnect(controlState.signalId);
    controlState.button.get_parent()?.remove_child(controlState.button);
    controlState.button.destroy();
    controlState.action = null;
    this.controlButtons.delete(controlId);
  }

  attach() {
    if (!this.actor.get_parent())
      this.popupContent.popupItem.add_child(this.actor);
  }

  remove() {
    if (!this.actor) return;

    for (const controlId of [...this.controlButtons.keys()])
      this.removePlaybackControl(controlId);
    this.actor.get_parent()?.remove_child(this.actor);
    this.actor.destroy();
    this.actor = null;
    this.primaryControlsBox = null;
    this.secondaryControlsBox = null;
  }

  destroy() {
    this.remove();
    this.playbackController = null;
    this.popupContent = null;
  }
}
