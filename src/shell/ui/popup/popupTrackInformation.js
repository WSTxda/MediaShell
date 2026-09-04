/**
 * @file popupTrackInformation.js
 * @module shell.ui.popup.popupTrackInformation
 *
 * Renders configurable track information inside the popup.
 *
 * PopupContent delegates popup-specific metadata labels to this component so it
 * can keep title and artist styling while using the shared ordered metadata
 * model also used by the top bar. Missing MPRIS fields are hidden by the shared
 * metadata helpers before labels are created.
 */

import { MediaShellStyleClasses } from "../style.js";
import Clutter from "gi://Clutter";
import St from "gi://St";

import { TrackInformationFields } from "../../../shared/ui/trackInformation.js";
import { buildTrackInformationItems } from "../../media/track/presentation.js";
import ScrollingLabel from "../components/scrollingLabel.js";

/**
 * Renders configurable track information inside the popup.
 */
export default class PopupTrackInformation {
  constructor(popupContent) {
    this.popupContent = popupContent;
    this.renderKey = null;
    this.trackInformationLabels = [];
  }

  get settings() {
    return this.popupContent.settings;
  }
  get player() {
    return this.popupContent.player;
  }
  get popupItem() {
    return this.popupContent.popupItem;
  }
  get progressBarActor() {
    return this.popupContent.progressBar.actor;
  }
  get playbackControlsActor() {
    return this.popupContent.playbackControls.actor;
  }
  get actor() {
    return this.trackInformationBox;
  }

  buildFixedWidthStyle(width) {
    return this.popupContent.buildFixedWidthStyle(width);
  }

  getTrackInformationWidth() {
    return this.popupContent.getTrackInformationWidth();
  }

  render() {
    const metadata = this.player.metadata;
    const width = this.getTrackInformationWidth();
    const items = buildTrackInformationItems(
      metadata,
      this.settings.trackInformationContent,
    );
    const renderKey = [
      ...items.map((item) => `${item.field ?? "TEXT"}:${item.text}`),
      width,
      this.settings.trackInformationScrollEnabled,
      this.settings.trackInformationScrollSpeed,
      this.settings.trackInformationScrollPauseMilliseconds,
    ].join("\u0001");

    if (renderKey === this.renderKey) {
      this.attach();
      return;
    }
    this.renderKey = renderKey;
    this.ensureContainer(width);
    this.clearLabels();

    for (const item of items) {
      const label = this.createLabel(
        item.text,
        this.resolveFieldStyleClass(item.field),
        width,
      );
      this.trackInformationLabels.push(label);
      this.trackInformationBox.add_child(label);
    }

    if (this.trackInformationLabels.length === 0) {
      this.trackInformationBox
        .get_parent()
        ?.remove_child(this.trackInformationBox);
      return;
    }
    this.attach();
  }

  ensureContainer(width) {
    if (!this.trackInformationBox) {
      this.trackInformationBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        styleClass: MediaShellStyleClasses.POPUP_TRACK_INFORMATION,
      });
    }
    const widthStyle = this.buildFixedWidthStyle(width);
    this.trackInformationBox.width = width;
    this.trackInformationBox.style = widthStyle;
    this.trackInformationBox.xExpand = true;
    this.trackInformationBox.xAlign = Clutter.ActorAlign.FILL;
  }

  createLabel(text, styleClass, width) {
    const label = new ScrollingLabel({
      text,
      isScrolling: this.settings.trackInformationScrollEnabled,
      width,
      scrollSpeed: this.settings.trackInformationScrollSpeed,
      scrollPauseMilliseconds:
        this.settings.trackInformationScrollPauseMilliseconds,
    });
    label.label.add_style_class_name(styleClass);
    const widthStyle = this.buildFixedWidthStyle(width);
    label.width = width;
    label.style = widthStyle;
    label.xExpand = true;
    label.xAlign = Clutter.ActorAlign.FILL;
    label.labelBox.width = width;
    label.labelBox.style = widthStyle;
    label.labelBox.xExpand = true;
    label.labelBox.xAlign = Clutter.ActorAlign.FILL;
    return label;
  }

  resolveFieldStyleClass(field) {
    if (field === TrackInformationFields.TITLE)
      return MediaShellStyleClasses.POPUP_TRACK_INFORMATION_TITLE;
    if (field === TrackInformationFields.ARTIST)
      return MediaShellStyleClasses.POPUP_TRACK_INFORMATION_ARTIST;
    return MediaShellStyleClasses.POPUP_TRACK_INFORMATION_ALBUM;
  }

  clearLabels() {
    for (const label of this.trackInformationLabels) {
      label.get_parent()?.remove_child(label);
      label.destroy();
    }
    this.trackInformationLabels.length = 0;
  }

  attach() {
    if (
      !this.trackInformationBox ||
      this.trackInformationBox.get_children().length === 0 ||
      this.trackInformationBox.get_parent()
    )
      return;

    if (this.progressBarActor?.get_parent() === this.popupItem) {
      this.popupItem.insert_child_below(
        this.trackInformationBox,
        this.progressBarActor,
      );
    } else if (this.playbackControlsActor?.get_parent() === this.popupItem) {
      this.popupItem.insert_child_below(
        this.trackInformationBox,
        this.playbackControlsActor,
      );
    } else {
      this.popupItem.add_child(this.trackInformationBox);
    }
  }

  remove() {
    this.clearLabels();
    this.trackInformationBox
      ?.get_parent()
      ?.remove_child(this.trackInformationBox);
    this.trackInformationBox?.destroy();
    this.trackInformationBox = null;
    this.renderKey = null;
  }

  destroy() {
    this.trackInformationBox?.destroy();
    this.trackInformationBox = null;
    this.trackInformationLabels.length = 0;
    this.renderKey = null;
    this.popupContent = null;
  }
}
