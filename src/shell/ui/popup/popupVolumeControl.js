/**
 * @file popupVolumeControl.js
 * @module shell.ui.popup.popupVolumeControl
 *
 * Owns the popup MPRIS volume slider and endpoint buttons.
 *
 * The component mirrors GNOME Shell's volume-row interaction: MPRIS property
 * updates resynchronize the slider and icon when no local drag owns the control,
 * while user changes are written through PlaybackController. The left endpoint toggles
 * mute and restores the last non-zero volume; the right endpoint raises volume by
 * a fixed popup-local step.
 */

import {
  MediaShellStyleClasses,
  NativeStyleClasses,
  styleClassNames,
} from "../style.js";
import Clutter from "gi://Clutter";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Slider from "resource:///org/gnome/shell/ui/slider.js";

import { ACTIVE_OPACITY, INACTIVE_OPACITY } from "../actorState.js";
import { POPUP_VOLUME_CONTROL_HORIZONTAL_INSET } from "./presentation.js";

const UNMUTE_DEFAULT_VOLUME = 0.25;
const VOLUME_UP_STEP = 0.1;
const VOLUME_ICON_NAMES = Object.freeze({
  MUTED: "audio-volume-muted-symbolic",
  LOW: "audio-volume-low-symbolic",
  HIGH: "audio-volume-high-symbolic",
});

/** Owns the popup volume row. */
export default class PopupVolumeControl {
  constructor(popupSurface, playbackController) {
    this.popupSurface = popupSurface;
    this.playbackController = playbackController;
    this.actor = null;
    this.muteButton = null;
    this.muteIcon = null;
    this.slider = null;
    this.volumeUpButton = null;
    this.volumeUpIcon = null;
    this.sliderChangedId = null;
    this.isDragging = false;
    this.playerBusName = null;
    this.lastNonZeroVolume = null;
  }

  get player() {
    return this.popupSurface.player;
  }

  get popupItem() {
    return this.popupSurface.popupItem;
  }

  get playbackControlsActor() {
    return this.popupSurface.playbackControls.actor;
  }

  render() {
    this.ensureActor();
    if (this.playerBusName !== this.player.busName) {
      this.playerBusName = this.player.busName;
      this.lastNonZeroVolume = null;
    }
    const width =
      this.popupSurface.getPopupContentWidth() -
      POPUP_VOLUME_CONTROL_HORIZONTAL_INSET * 2;
    this.actor.width = width;
    this.actor.style = this.popupSurface.buildFixedWidthStyle(width);
    this.syncVolume(this.player.volume);
    this.syncControlState();
    this.attach();
  }

  ensureActor() {
    if (this.actor) return;

    this.actor = new St.BoxLayout({
      styleClass: MediaShellStyleClasses.POPUP_VOLUME_CONTROL,
      xExpand: false,
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.muteIcon = new St.Icon({
      iconName: VOLUME_ICON_NAMES.MUTED,
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.muteIcon.set_icon_size(16);
    this.muteButton = new St.Button({
      child: this.muteIcon,
      styleClass: styleClassNames(
        NativeStyleClasses.ICON_BUTTON,
        NativeStyleClasses.FLAT,
        MediaShellStyleClasses.POPUP_VOLUME_ICON_BUTTON,
      ),
      xExpand: false,
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.muteButton.connectObject("clicked", () => this.toggleMute(), this);

    this.slider = new Slider.Slider(0);
    this.slider.accessible_name = _("Volume");
    this.slider.xExpand = true;
    this.sliderChangedId = this.slider.connect("notify::value", () => {
      const value = this.slider.value;
      if (value > 0) this.lastNonZeroVolume = value;
      this.syncVolumePresentation(value);
      void this.playbackController.setVolume(value, this.player);
    });
    this.slider.connectObject(
      "drag-begin",
      () => {
        this.isDragging = true;
      },
      "drag-end",
      () => {
        this.isDragging = false;
      },
      this,
    );

    this.volumeUpIcon = new St.Icon({
      iconName: VOLUME_ICON_NAMES.HIGH,
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.volumeUpIcon.set_icon_size(16);
    this.volumeUpButton = new St.Button({
      child: this.volumeUpIcon,
      styleClass: styleClassNames(
        NativeStyleClasses.ICON_BUTTON,
        NativeStyleClasses.FLAT,
        MediaShellStyleClasses.POPUP_VOLUME_ICON_BUTTON,
      ),
      xExpand: false,
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.volumeUpButton.set_accessible_name(_("Volume up"));
    this.volumeUpButton.connectObject(
      "clicked",
      () => this.increaseVolume(),
      this,
    );

    this.actor.add_child(this.muteButton);
    this.actor.add_child(this.slider);
    this.actor.add_child(this.volumeUpButton);
  }

  syncVolume(volume) {
    if (this.isDragging) return;

    const normalizedVolume = Number.isFinite(volume) ? Math.max(0, volume) : 0;
    if (normalizedVolume > 0) this.lastNonZeroVolume = normalizedVolume;

    this.slider.block_signal_handler(this.sliderChangedId);
    this.slider.value = Math.min(normalizedVolume, 1);
    this.slider.unblock_signal_handler(this.sliderChangedId);
    this.syncVolumePresentation(normalizedVolume);
  }

  syncVolumePresentation(volume) {
    const isMuted = volume <= 0;
    this.muteIcon.iconName = isMuted
      ? VOLUME_ICON_NAMES.MUTED
      : VOLUME_ICON_NAMES.LOW;
    this.muteButton.set_accessible_name(isMuted ? _("Unmute") : _("Mute"));
  }

  syncControlState() {
    const isReactive = this.player.canControl;
    this.slider.reactive = isReactive;
    this.muteButton.reactive = isReactive;
    this.muteButton.canFocus = isReactive;
    this.volumeUpButton.reactive = isReactive;
    this.volumeUpButton.canFocus = isReactive;
    this.actor.opacity = isReactive ? ACTIVE_OPACITY : INACTIVE_OPACITY;
  }

  toggleMute() {
    if (!this.player.canControl) return;

    const currentVolume = this.player.volume;
    if (currentVolume > 0) {
      this.lastNonZeroVolume = currentVolume;
      void this.playbackController.setVolume(0, this.player);
      return;
    }

    void this.playbackController.setVolume(
      this.lastNonZeroVolume ?? UNMUTE_DEFAULT_VOLUME,
      this.player,
    );
  }

  increaseVolume() {
    if (!this.player.canControl) return;

    const currentVolume = Number.isFinite(this.player.volume)
      ? Math.max(0, this.player.volume)
      : 0;
    if (currentVolume >= 1) return;

    const targetVolume = Math.min(currentVolume + VOLUME_UP_STEP, 1);
    this.lastNonZeroVolume = targetVolume;
    void this.playbackController.setVolume(targetVolume, this.player);
  }

  attach() {
    if (this.actor.get_parent() === this.popupItem) return;

    if (this.playbackControlsActor?.get_parent() === this.popupItem)
      this.popupItem.insert_child_above(this.actor, this.playbackControlsActor);
    else this.popupItem.add_child(this.actor);
  }

  reconcilePosition() {
    if (!this.actor?.get_parent()) return;
    if (this.playbackControlsActor?.get_parent() !== this.popupItem) return;

    const children = this.popupItem.get_children();
    const controlsIndex = children.indexOf(this.playbackControlsActor);
    const volumeIndex = children.indexOf(this.actor);
    if (volumeIndex === controlsIndex + 1) return;

    this.popupItem.remove_child(this.actor);
    this.popupItem.insert_child_above(this.actor, this.playbackControlsActor);
  }

  remove() {
    if (!this.actor) return;

    this.muteButton.disconnectObject(this);
    this.slider.disconnectObject(this);
    this.volumeUpButton.disconnectObject(this);
    if (this.sliderChangedId !== null)
      this.slider.disconnect(this.sliderChangedId);
    this.actor.get_parent()?.remove_child(this.actor);
    this.actor.destroy();
    this.actor = null;
    this.muteButton = null;
    this.muteIcon = null;
    this.slider = null;
    this.volumeUpButton = null;
    this.volumeUpIcon = null;
    this.sliderChangedId = null;
    this.isDragging = false;
    this.playerBusName = null;
    this.lastNonZeroVolume = null;
  }

  destroy() {
    this.remove();
    this.playbackController = null;
    this.popupSurface = null;
  }
}
