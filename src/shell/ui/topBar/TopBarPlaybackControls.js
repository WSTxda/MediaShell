/**
 * @file TopBarPlaybackControls.js
 * @module shell.ui.topBar.TopBarPlaybackControls
 *
 * Renders compact playback controls inside the top bar button.
 *
 * TopBarButton owns this component and asks it to update button visibility and
 * sensitivity from the active PlayerProxy. The renderer consumes shared
 * PlaybackControls descriptors so popup and top bar action names stay aligned.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";

import { PlaybackControls } from "../../../shared/constants/playbackControls.js";
import { WidgetFlags } from "../../../shared/enums/widget.js";
import {
  resolveLoopControl,
  resolvePlayPauseControl,
  resolveShuffleControl,
} from "../../../shared/utils/playbackControlState.js";
import {
  ACTIVE_OPACITY,
  INACTIVE_OPACITY,
} from "../../constants/actorState.js";
import { TOP_BAR_PLAYBACK_CONTROL_ORDER } from "../../constants/playbackControls.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import { createIcon, setIconName } from "../../utils/icons.js";
import { styleClassNames } from "../../utils/styleClasses.js";

function getPlaybackControlIconOpacity(isReactive, isStateControl, isActive) {
  if (!isReactive) return INACTIVE_OPACITY;
  if (isStateControl && !isActive) return INACTIVE_OPACITY;
  return ACTIVE_OPACITY;
}

/**
 * Renders compact playback controls inside the top bar button.
 */
export default class TopBarPlaybackControls {
  constructor(topBarButton) {
    this.topBarButton = topBarButton;
    this.actor = null;
    this.controlButtons = new Map();
  }

  render(widgetFlags) {
    this.ensureActor();

    if (widgetFlags & WidgetFlags.TOP_BAR_PLAYBACK_SHUFFLE)
      this.renderShuffle();
    if (widgetFlags & WidgetFlags.TOP_BAR_PLAYBACK_PREVIOUS) {
      this.renderOptionalControl(
        this.topBarButton.extensionController
          .topBarPlaybackControlsPreviousTrackShow,
        PlaybackControls.PREVIOUS,
        this.topBarButton.mediaApp.canGoPrevious &&
          this.topBarButton.mediaApp.canControl,
        () => this.topBarButton.mediaApp.previous(),
      );
    }
    if (widgetFlags & WidgetFlags.TOP_BAR_PLAYBACK_PLAY_PAUSE)
      this.renderPlayPause();
    if (widgetFlags & WidgetFlags.TOP_BAR_PLAYBACK_NEXT) {
      this.renderOptionalControl(
        this.topBarButton.extensionController
          .topBarPlaybackControlsNextTrackShow,
        PlaybackControls.NEXT,
        this.topBarButton.mediaApp.canGoNext &&
          this.topBarButton.mediaApp.canControl,
        () => this.topBarButton.mediaApp.next(),
      );
    }
    if (widgetFlags & WidgetFlags.TOP_BAR_PLAYBACK_REPEAT) this.renderRepeat();

    // Partial MPRIS updates must never use the configured absolute index of
    // one control in isolation. Reconcile the complete visible row once so
    // play/pause and capability changes cannot temporarily shuffle actors.
    this.reconcileOrder();
    this.attach();
  }

  ensureActor() {
    if (!this.actor) {
      this.actor = new St.BoxLayout({
        name: StyleClasses.TOP_BAR_PLAYBACK_CONTROLS,
        styleClass: StyleClasses.TOP_BAR_PLAYBACK_CONTROLS,
      });
    }
  }

  renderOptionalControl(isVisible, controlDefinition, isReactive, action) {
    if (isVisible)
      this.updatePlaybackControl(controlDefinition, isReactive, action);
    else this.removePlaybackControl(controlDefinition);
  }

  renderShuffle() {
    if (
      !this.topBarButton.extensionController.topBarPlaybackControlsShuffleShow
    ) {
      this.removePlaybackControl(PlaybackControls.SHUFFLE_ON);
      return;
    }

    const { control, isReactive, action, isActive } = resolveShuffleControl(
      this.topBarButton.mediaApp,
    );
    this.updatePlaybackControl(control, isReactive, action, isActive);
  }

  renderPlayPause() {
    if (
      !this.topBarButton.extensionController.topBarPlaybackControlsPlayPauseShow
    ) {
      this.removePlaybackControl(PlaybackControls.PLAY);
      return;
    }

    const { control, isReactive, action } = resolvePlayPauseControl(
      this.topBarButton.mediaApp,
    );
    this.updatePlaybackControl(control, isReactive, action);
  }

  renderRepeat() {
    if (
      !this.topBarButton.extensionController.topBarPlaybackControlsRepeatShow
    ) {
      this.removePlaybackControl(PlaybackControls.LOOP_NONE);
      return;
    }

    const { control, isReactive, action, isActive } = resolveLoopControl(
      this.topBarButton.mediaApp,
    );
    this.updatePlaybackControl(control, isReactive, action, isActive);
  }

  updatePlaybackControl(
    controlDefinition,
    isReactive,
    action,
    isActive = false,
  ) {
    let control = this.controlButtons.get(controlDefinition.name);
    if (!control) {
      const isStateControl =
        controlDefinition.name === PlaybackControls.LOOP_NONE.name ||
        controlDefinition.name === PlaybackControls.SHUFFLE_ON.name;
      const button = new St.Button({
        name: controlDefinition.name,
        styleClass: StyleClasses.TOP_BAR_CONTROL_BUTTON,
        xAlign: Clutter.ActorAlign.CENTER,
        yAlign: Clutter.ActorAlign.CENTER,
        canFocus: false,
        trackHover: false,
        toggleMode: isStateControl,
      });
      const icon = createIcon({
        styleClass: styleClassNames(
          StyleClasses.SYSTEM_STATUS_ICON,
          StyleClasses.NO_MARGIN,
          StyleClasses.TOP_BAR_CONTROL_ICON,
        ),
      });
      const signalId = button.connect("clicked", () => control.action?.());
      control = { button, icon, signalId, action };
      button.set_child(icon);
      this.controlButtons.set(controlDefinition.name, control);
    }

    control.action = action;
    setIconName(control.icon, controlDefinition.iconName);
    control.button.opacity = ACTIVE_OPACITY;
    control.button.reactive = isReactive;
    control.button.checked = isActive;
    control.icon.opacity = getPlaybackControlIconOpacity(
      isReactive,
      control.button.toggleMode,
      isActive,
    );
  }

  reconcileOrder() {
    const orderedActors = TOP_BAR_PLAYBACK_CONTROL_ORDER.map(
      (name) => this.controlButtons.get(name)?.button,
    ).filter(Boolean);

    for (let index = 0; index < orderedActors.length; index++) {
      const actor = orderedActors[index];
      const children = this.actor.get_children();
      if (children[index] === actor) continue;

      actor.get_parent()?.remove_child(actor);
      this.actor.insert_child_at_index(actor, index);
    }
  }

  removePlaybackControl(controlDefinition) {
    const control = this.controlButtons.get(controlDefinition.name);
    if (!control) return;
    control.button.disconnect(control.signalId);
    control.button.get_parent()?.remove_child(control.button);
    control.button.destroy();
    control.action = null;
    this.controlButtons.delete(controlDefinition.name);
  }

  attach() {
    const topBarBox = this.topBarButton.topBarBox;
    const afterActionBox = this.topBarButton.topBarActionBoxAfter;
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
    for (const name of [...this.controlButtons.keys()])
      this.removePlaybackControl({ name });
    this.actor.get_parent()?.remove_child(this.actor);
    this.actor.destroy();
    this.actor = null;
  }

  destroy() {
    this.remove();
    this.topBarButton = null;
  }
}
