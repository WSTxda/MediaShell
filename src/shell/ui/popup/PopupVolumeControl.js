/**
 * @file PopupVolumeControl.js
 * @module shell.ui.popup.PopupVolumeControl
 *
 * Owns the popup MPRIS volume slider and mute button.
 *
 * The component mirrors GNOME Shell's volume-row interaction: MPRIS property
 * updates resynchronize the slider and icon when no local drag owns the control,
 * while user changes are written through MprisMediaApp. The last non-zero volume
 * is retained only so the icon button can restore it after muting.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Slider from "resource:///org/gnome/shell/ui/slider.js";

import {
  ACTIVE_OPACITY,
  INACTIVE_OPACITY,
} from "../../constants/actorState.js";
import { POPUP_VOLUME_CONTROL_HORIZONTAL_INSET } from "../../constants/popup.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import { styleClassNames } from "../../utils/styleClasses.js";

const UNMUTE_DEFAULT_VOLUME = 0.25;
const VOLUME_ICON_NAMES = Object.freeze([
  "audio-volume-muted-symbolic",
  "audio-volume-low-symbolic",
  "audio-volume-medium-symbolic",
  "audio-volume-high-symbolic",
]);

function resolveVolumeIconName(volume) {
  if (volume <= 0) return VOLUME_ICON_NAMES[0];

  const normalizedVolume = Math.min(volume, 1);
  const maximumIconIndex = VOLUME_ICON_NAMES.length - 1;
  return VOLUME_ICON_NAMES[Math.ceil(normalizedVolume * maximumIconIndex)];
}

/** Owns the popup volume row. */
export default class PopupVolumeControl {
  constructor(popupContent) {
    this.popupContent = popupContent;
    this.actor = null;
    this.iconButton = null;
    this.icon = null;
    this.slider = null;
    this.percentageLabel = null;
    this.sliderChangedId = null;
    this.isDragging = false;
    this.mediaAppBusName = null;
    this.lastNonZeroVolume = null;
  }

  get mediaApp() {
    return this.popupContent.mediaApp;
  }

  get popupItem() {
    return this.popupContent.popupItem;
  }

  get playbackControlsActor() {
    return this.popupContent.playbackControls.actor;
  }

  render() {
    this.ensureActor();
    if (this.mediaAppBusName !== this.mediaApp.busName) {
      this.mediaAppBusName = this.mediaApp.busName;
      this.lastNonZeroVolume = null;
    }
    const width =
      this.popupContent.getPopupContentWidth() -
      POPUP_VOLUME_CONTROL_HORIZONTAL_INSET * 2;
    this.actor.width = width;
    this.actor.style = this.popupContent.buildFixedWidthStyle(width);
    this.syncVolume(this.mediaApp.volume);
    this.syncControlState();
    this.attach();
  }

  ensureActor() {
    if (this.actor) return;

    this.actor = new St.BoxLayout({
      styleClass: StyleClasses.POPUP_VOLUME_CONTROL,
      xExpand: false,
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.icon = new St.Icon({
      iconName: VOLUME_ICON_NAMES[0],
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.icon.set_icon_size(16);
    this.iconButton = new St.Button({
      child: this.icon,
      styleClass: styleClassNames(
        StyleClasses.ICON_BUTTON,
        StyleClasses.FLAT,
        StyleClasses.POPUP_VOLUME_ICON_BUTTON,
      ),
      xExpand: false,
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.iconButton.connectObject("clicked", () => this.toggleMute(), this);

    this.slider = new Slider.Slider(0);
    this.slider.accessible_name = _("Volume");
    this.slider.xExpand = true;
    this.sliderChangedId = this.slider.connect("notify::value", () => {
      const value = this.slider.value;
      if (value > 0) this.lastNonZeroVolume = value;
      this.syncVolumePresentation(value);
      void this.mediaApp.setVolume(value);
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

    this.percentageLabel = new St.Label({
      styleClass: StyleClasses.POPUP_VOLUME_PERCENTAGE,
      text: "0%",
      xExpand: false,
      xAlign: Clutter.ActorAlign.END,
      yAlign: Clutter.ActorAlign.CENTER,
    });

    this.actor.add_child(this.iconButton);
    this.actor.add_child(this.slider);
    this.actor.add_child(this.percentageLabel);
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
    this.icon.iconName = resolveVolumeIconName(volume);
    this.iconButton.set_accessible_name(volume > 0 ? _("Mute") : _("Unmute"));
    const percentage = Math.round(Math.max(0, volume) * 100);
    this.percentageLabel.text = `${percentage}%`;
  }

  syncControlState() {
    const isReactive = this.mediaApp.canControl;
    this.slider.reactive = isReactive;
    this.iconButton.reactive = isReactive;
    this.iconButton.canFocus = isReactive;
    this.actor.opacity = isReactive ? ACTIVE_OPACITY : INACTIVE_OPACITY;
  }

  toggleMute() {
    if (!this.mediaApp.canControl) return;

    const currentVolume = this.mediaApp.volume;
    if (currentVolume > 0) {
      this.lastNonZeroVolume = currentVolume;
      void this.mediaApp.setVolume(0);
      return;
    }

    void this.mediaApp.setVolume(
      this.lastNonZeroVolume ?? UNMUTE_DEFAULT_VOLUME,
    );
  }

  attach() {
    if (this.actor.get_parent() === this.popupItem) return;

    if (this.playbackControlsActor?.get_parent() === this.popupItem)
      this.popupItem.insert_child_above(this.actor, this.playbackControlsActor);
    else
      this.popupItem.add_child(this.actor);
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

    this.iconButton.disconnectObject(this);
    this.slider.disconnectObject(this);
    if (this.sliderChangedId !== null)
      this.slider.disconnect(this.sliderChangedId);
    this.actor.get_parent()?.remove_child(this.actor);
    this.actor.destroy();
    this.actor = null;
    this.iconButton = null;
    this.icon = null;
    this.slider = null;
    this.percentageLabel = null;
    this.sliderChangedId = null;
    this.isDragging = false;
    this.mediaAppBusName = null;
    this.lastNonZeroVolume = null;
  }

  destroy() {
    this.remove();
    this.popupContent = null;
  }
}
