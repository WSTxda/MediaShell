/**
 * @file topBarPlaybackControls.js
 * @module shell.ui.topbar.topBarPlaybackControls
 *
 * Renders configurable playback controls inside the top bar.
 *
 * TopBarContent owns surface visibility. This renderer owns top-bar actors and
 * delegates state and execution to the shared playback-control domain.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { PlaybackControlSurfaces } from "../../../shared/playback/surfaces.js";
import { resolvePlaybackControlState } from "../../media/playback/controlState.js";
import { resolvePlaybackControlSurfaceUpdates } from "../../media/playback/surfaceState.js";
import {
  ACTIVE_OPACITY,
  INACTIVE_OPACITY,
} from "../../constants/actorState.js";
import { TOP_BAR_PLAYBACK_CONTROL_ORDER } from "../../constants/playbackControls.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import { executePlaybackControlAction } from "../../mpris/playbackControlExecutor.js";
import { reconcileActorOrder } from "../../utils/actors.js";
import { updatePlaybackControlButton } from "../../utils/playbackControlButton.js";
import {
  createPlaybackControlContent,
  updatePlaybackControlContent,
} from "../../utils/playbackControlContent.js";
import { styleClassNames } from "../../utils/styleClasses.js";

/** Renders configurable playback controls inside the top bar. */
export default class TopBarPlaybackControls {
  constructor(topBarContent) {
    this.topBarContent = topBarContent;
    this.actor = null;
    this.controlButtons = new Map();
  }

  get extensionController() {
    return this.topBarContent.extensionController;
  }

  get mediaApp() {
    return this.topBarContent.mediaApp;
  }

  render(widgetFlags) {
    this.ensureActor();
    const updates = resolvePlaybackControlSurfaceUpdates(
      this.extensionController,
      PlaybackControlSurfaces.TOP_BAR,
      widgetFlags,
    );
    for (const { controlId, isVisible } of updates)
      this.reconcilePlaybackControl(controlId, isVisible);

    if (this.controlButtons.size === 0) {
      this.remove();
      return;
    }

    this.reconcileOrder();
    this.attach();
  }

  ensureActor() {
    if (this.actor) return;

    this.actor = new St.BoxLayout({
      name: StyleClasses.TOP_BAR_PLAYBACK_CONTROLS,
      styleClass: StyleClasses.TOP_BAR_PLAYBACK_CONTROLS,
    });
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

    const button = new St.Button({
      name: controlDefinition.actorName,
      styleClass: StyleClasses.TOP_BAR_CONTROL_BUTTON,
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
      toggleMode: controlDefinition.isStateControl,
    });
    const content = createPlaybackControlContent(controlDefinition, {
      iconStyleClass: styleClassNames(
        StyleClasses.SYSTEM_STATUS_ICON,
        StyleClasses.NO_MARGIN,
        StyleClasses.TOP_BAR_CONTROL_ICON,
      ),
      labelStyleClass: styleClassNames(
        StyleClasses.NO_MARGIN,
        StyleClasses.TOP_BAR_CONTROL_LABEL,
      ),
    });
    buttonState = { button, content, signalId: 0, action: null };
    buttonState.signalId = button.connect("clicked", () => {
      if (!buttonState.button.reactive) return;
      void executePlaybackControlAction(this.mediaApp, buttonState.action);
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
      isActive,
    } = controlState;

    buttonState.action = action;
    updatePlaybackControlContent(buttonState.content, { iconName, labelText });
    updatePlaybackControlButton(
      buttonState.button,
      this.mediaApp,
      controlState,
      _,
    );
    buttonState.button.opacity = ACTIVE_OPACITY;
    buttonState.content.actor.opacity = getContentOpacity(
      isReactive,
      controlDefinition.isStateControl,
      isActive,
    );
  }

  reconcileOrder() {
    reconcileActorOrder(
      this.actor,
      TOP_BAR_PLAYBACK_CONTROL_ORDER.map(
        (controlId) => this.controlButtons.get(controlId)?.button,
      ),
    );
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
    const topBarBox = this.topBarContent.topBarBox;
    const afterActionBox = this.topBarContent.topBarActionBoxAfter;
    const parent = this.actor.get_parent();
    const targetIndex = topBarBox.get_children().indexOf(afterActionBox);
    const currentIndex =
      parent === topBarBox ? topBarBox.get_children().indexOf(this.actor) : -1;
    if (targetIndex >= 0 && currentIndex === targetIndex - 1) return;

    parent?.remove_child(this.actor);
    const nextTargetIndex = topBarBox.get_children().indexOf(afterActionBox);
    topBarBox.insert_child_at_index(
      this.actor,
      nextTargetIndex >= 0 ? nextTargetIndex : topBarBox.get_n_children(),
    );
  }

  remove() {
    if (!this.actor) return;

    for (const controlId of [...this.controlButtons.keys()])
      this.removePlaybackControl(controlId);
    this.actor.get_parent()?.remove_child(this.actor);
    this.actor.destroy();
    this.actor = null;
  }

  destroy() {
    this.remove();
    this.topBarContent = null;
  }
}

function getContentOpacity(isReactive, isStateControl, isActive) {
  if (!isReactive) return INACTIVE_OPACITY;
  if (isStateControl && !isActive) return INACTIVE_OPACITY;
  return ACTIVE_OPACITY;
}
