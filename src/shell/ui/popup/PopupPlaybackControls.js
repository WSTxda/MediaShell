/**
 * @file PopupPlaybackControls.js
 * @module shell.ui.popup.PopupPlaybackControls
 *
 * Renders popup playback, shuffle, and repeat controls for the active media app.
 *
 * PopupContent delegates button creation and sensitivity updates to this class so
 * transport-control state stays separate from the progress bar and track information widgets.
 * The component consumes shared PlaybackControls descriptors for stable button names.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";

import { PlaybackControls } from "../../../shared/constants/playbackControls.js";
import { LoopStatus } from "../../../shared/enums/playback.js";
import { WidgetFlags } from "../../../shared/enums/widget.js";
import { resolvePlayPauseControl } from "../../../shared/utils/playbackControlState.js";
import {
  ACTIVE_OPACITY,
  INACTIVE_OPACITY,
} from "../../constants/actorState.js";
import { createIcon, setIconName } from "../../utils/icons.js";

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

  // widgetFlags controls which buttons need updating; no parent positioning needed
  render(widgetFlags) {
    this.ensureActors();
    const mediaApp = this.mediaApp;

    if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_SHUFFLE) {
      this.updatePlaybackControl(
        mediaApp.shuffle
          ? PlaybackControls.SHUFFLE_ON
          : PlaybackControls.SHUFFLE_OFF,
        mediaApp.canControl,
        () => mediaApp.toggleShuffle(),
      );
    }
    if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_PREVIOUS) {
      this.updatePlaybackControl(
        PlaybackControls.PREVIOUS,
        mediaApp.canGoPrevious && mediaApp.canControl,
        () => mediaApp.previous(),
      );
    }
    if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_PLAY_PAUSE)
      this.updatePlayPause(mediaApp);
    if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_NEXT) {
      this.updatePlaybackControl(
        PlaybackControls.NEXT,
        mediaApp.canGoNext && mediaApp.canControl,
        () => mediaApp.next(),
      );
    }
    if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_LOOP) {
      const loopControlDefinition =
        mediaApp.loopStatus === LoopStatus.NONE
          ? PlaybackControls.LOOP_NONE
          : mediaApp.loopStatus === LoopStatus.TRACK
            ? PlaybackControls.LOOP_TRACK
            : PlaybackControls.LOOP_PLAYLIST;
      this.updatePlaybackControl(
        loopControlDefinition,
        mediaApp.canControl,
        () => mediaApp.toggleLoop(),
      );
    }

    if (!this.playbackControlsBox.get_parent()) {
      this.popupItem.add_child(this.playbackControlsBox);
    }
  }

  ensureActors() {
    if (this.playbackControlsBox) return;

    this.playbackControlsBox = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: "mediashell-popup-playback-controls",
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.primaryPlaybackControlsBox = new St.BoxLayout({
      styleClass: "mediashell-popup-primary-controls",
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.secondaryPlaybackControlsBox = new St.BoxLayout({
      styleClass: "mediashell-popup-secondary-controls",
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.playbackControlsBox.add_child(this.primaryPlaybackControlsBox);
    this.playbackControlsBox.add_child(this.secondaryPlaybackControlsBox);
  }

  updatePlayPause(mediaApp) {
    const { control, isReactive, action } = resolvePlayPauseControl(mediaApp);
    this.updatePlaybackControl(control, isReactive, action);
  }

  updatePlaybackControl(controlDefinition, isReactive, onClick) {
    const controlName = controlDefinition.name;
    const isPrimaryTransport = controlName === PlaybackControls.PLAY.name;
    const isSecondary =
      controlName === PlaybackControls.LOOP_NONE.name ||
      controlName === PlaybackControls.SHUFFLE_ON.name;
    const isActive =
      controlDefinition === PlaybackControls.LOOP_TRACK ||
      controlDefinition === PlaybackControls.LOOP_PLAYLIST ||
      controlDefinition === PlaybackControls.SHUFFLE_ON;
    const targetControlsBox = isSecondary
      ? this.secondaryPlaybackControlsBox
      : this.primaryPlaybackControlsBox;

    let control = this.controlButtons.get(controlName);
    if (!control) {
      const styleClasses = [
        "button",
        "mediashell-popup-control-button",
        isPrimaryTransport
          ? "mediashell-popup-control-button-primary"
          : "mediashell-popup-control-button-circular",
        isSecondary ? "mediashell-popup-control-button-state" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const button = new St.Button({
        name: controlName,
        styleClass: styleClasses,
        xAlign: Clutter.ActorAlign.CENTER,
        yAlign: Clutter.ActorAlign.CENTER,
        toggleMode: isSecondary,
      });
      const icon = createIcon({
        styleClass: "popup-menu-icon mediashell-popup-control-icon",
      });
      control = { button, icon, onClick };
      button.set_child(icon);
      button.connect("clicked", () => {
        if (control.button.reactive) control.onClick?.();
      });
      this.controlButtons.set(controlName, control);
    }

    control.onClick = onClick;
    setIconName(control.icon, controlDefinition.iconName);
    control.button.trackHover = isReactive;
    control.button.opacity = isReactive ? ACTIVE_OPACITY : INACTIVE_OPACITY;
    control.button.reactive = isReactive;
    control.button.canFocus = isReactive;
    control.button.checked = isActive;
    this.placePlaybackControl(
      targetControlsBox,
      control.button,
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

  destroy() {
    this.playbackControlsBox?.destroy();
    this.controlButtons.clear();
    this.playbackControlsBox = null;
    this.primaryPlaybackControlsBox = null;
    this.secondaryPlaybackControlsBox = null;
    this.popupContent = null;
  }
}
