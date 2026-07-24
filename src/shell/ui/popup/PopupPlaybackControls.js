/**
 * @file PopupPlaybackControls.js
 * @module shell.ui.popup.PopupPlaybackControls
 *
 * Renders popup playback, shuffle, and repeat controls for the active media app.
 *
 * PopupContent delegates button creation and sensitivity updates to this class so
 * playback control state stays separate from the progress bar and track information widgets.
 * The component consumes shared PlaybackControls descriptors for stable button names.
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
import { StyleClasses } from "../../constants/styleClasses.js";
import { createIcon, setIconName } from "../../utils/icons.js";
import { styleClassNames } from "../../utils/styleClasses.js";

function getPopupPlaybackControlIndex(controlName) {
  if (
    controlName === PlaybackControls.SHUFFLE_ON.name ||
    controlName === PlaybackControls.PREVIOUS.name
  )
    return 0;
  if (controlName === PlaybackControls.PLAY.name) return 1;
  if (
    controlName === PlaybackControls.NEXT.name ||
    controlName === PlaybackControls.LOOP_NONE.name
  )
    return 2;
  return 0;
}

/**
 * Renders popup playback, shuffle, and repeat controls for the active media app.
 */
export default class PopupPlaybackControls {
  constructor(popupContent) {
    this.popupContent = popupContent;
    this.controlButtons = new Map();
  }

  get mediaApp() {
    return this.popupContent.mediaApp;
  }
  get popupItem() {
    return this.popupContent.popupItem;
  }
  get actor() {
    return this.playbackControlsBox;
  }

  render(widgetFlags) {
    this.ensureActors();
    const mediaApp = this.mediaApp;

    if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_SHUFFLE) this.renderShuffle();
    if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_PREVIOUS) {
      this.updatePlaybackControl({
        control: PlaybackControls.PREVIOUS,
        isReactive: mediaApp.canGoPrevious && mediaApp.canControl,
        action: () => mediaApp.previous(),
      });
    }
    if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_PLAY_PAUSE)
      this.renderPlayPause();
    if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_NEXT) {
      this.updatePlaybackControl({
        control: PlaybackControls.NEXT,
        isReactive: mediaApp.canGoNext && mediaApp.canControl,
        action: () => mediaApp.next(),
      });
    }
    if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_LOOP) this.renderRepeat();

    this.attach();
  }

  ensureActors() {
    if (this.playbackControlsBox) return;

    this.playbackControlsBox = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: StyleClasses.POPUP_PLAYBACK_CONTROLS,
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.primaryPlaybackControlsBox = new St.BoxLayout({
      styleClass: StyleClasses.POPUP_PRIMARY_CONTROLS,
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.secondaryPlaybackControlsBox = new St.BoxLayout({
      styleClass: StyleClasses.POPUP_SECONDARY_CONTROLS,
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.playbackControlsBox.add_child(this.primaryPlaybackControlsBox);
    this.playbackControlsBox.add_child(this.secondaryPlaybackControlsBox);
  }

  renderShuffle() {
    this.updatePlaybackControl(resolveShuffleControl(this.mediaApp));
  }

  renderPlayPause() {
    this.updatePlaybackControl(resolvePlayPauseControl(this.mediaApp));
  }

  renderRepeat() {
    this.updatePlaybackControl(resolveLoopControl(this.mediaApp));
  }

  updatePlaybackControl({
    control: controlDefinition,
    isReactive,
    action,
    isActive = false,
  }) {
    const controlName = controlDefinition.name;
    const isPrimaryTransport = controlName === PlaybackControls.PLAY.name;
    const isSecondary =
      controlName === PlaybackControls.LOOP_NONE.name ||
      controlName === PlaybackControls.SHUFFLE_ON.name;
    const targetControlsBox = isSecondary
      ? this.secondaryPlaybackControlsBox
      : this.primaryPlaybackControlsBox;

    let controlState = this.controlButtons.get(controlName);
    if (!controlState) {
      const buttonStyleClass = styleClassNames(
        StyleClasses.BUTTON,
        StyleClasses.POPUP_CONTROL_BUTTON,
        isPrimaryTransport
          ? StyleClasses.POPUP_CONTROL_BUTTON_PRIMARY
          : StyleClasses.POPUP_CONTROL_BUTTON_CIRCULAR,
        isSecondary ? StyleClasses.POPUP_CONTROL_BUTTON_STATE : null,
      );
      const button = new St.Button({
        name: controlName,
        styleClass: buttonStyleClass,
        xAlign: Clutter.ActorAlign.CENTER,
        yAlign: Clutter.ActorAlign.CENTER,
        toggleMode: isSecondary,
      });
      const icon = createIcon({
        styleClass: styleClassNames(
          StyleClasses.POPUP_MENU_ICON,
          StyleClasses.POPUP_CONTROL_ICON,
        ),
      });
      controlState = { button, icon, action };
      button.set_child(icon);
      button.connect("clicked", () => {
        if (controlState.button.reactive) controlState.action?.();
      });
      this.controlButtons.set(controlName, controlState);
    }

    controlState.action = action;
    setIconName(controlState.icon, controlDefinition.iconName);
    controlState.button.trackHover = isReactive;
    controlState.button.opacity = isReactive
      ? ACTIVE_OPACITY
      : INACTIVE_OPACITY;
    controlState.button.reactive = isReactive;
    controlState.button.canFocus = isReactive;
    controlState.button.checked = isActive;
    this.placePlaybackControl(
      targetControlsBox,
      controlState.button,
      getPopupPlaybackControlIndex(controlName),
    );
  }

  placePlaybackControl(targetControlsBox, button, index) {
    const children = targetControlsBox.get_children();
    const currentIndex = children.indexOf(button);
    const targetIndex = Math.min(
      index,
      children.length - (currentIndex >= 0 ? 1 : 0),
    );
    if (
      currentIndex === targetIndex &&
      button.get_parent() === targetControlsBox
    )
      return;

    button.get_parent()?.remove_child(button);
    targetControlsBox.insert_child_at_index(button, Math.max(0, targetIndex));
  }

  attach() {
    if (!this.playbackControlsBox.get_parent())
      this.popupItem.add_child(this.playbackControlsBox);
  }

  destroy() {
    this.playbackControlsBox?.destroy();
    this.controlButtons.clear();
    this.playbackControlsBox = null;
    this.primaryPlaybackControlsBox = null;
    this.secondaryPlaybackControlsBox = null;
    this.popupContent = null;
  }
}
