/**
 * @file PopupTrackInformation.js
 * @module shell.ui.popup.PopupTrackInformation
 *
 * Renders title, artist, and album metadata inside the popup.
 *
 * PopupContent delegates popup-specific metadata labels to this component so it
 * can apply display fallbacks and visibility rules independently from top bar
 * scrolling text. The component reads normalized PlayerProxy metadata through
 * shared helpers instead of reimplementing field parsing.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { PlaybackStatus } from "../../../shared/enums/playback.js";
import { readTrackInformation } from "../../../shared/utils/metadata.js";
import ScrollingLabel from "../ScrollingLabel.js";

/**
 * Renders title, artist, and album metadata inside the popup.
 */
export default class PopupTrackInformation {
  constructor(popupContent) {
    this.popupContent = popupContent;
    this.renderKey = null;
  }

  get extensionController() {
    return this.popupContent.extensionController;
  }
  get mediaApp() {
    return this.popupContent.mediaApp;
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

  pause() {
    this.titleLabel?.pauseScrolling();
    this.artistLabel?.pauseScrolling();
    this.albumLabel?.pauseScrolling();
  }

  resume() {
    this.titleLabel?.resumeScrolling();
    this.artistLabel?.resumeScrolling();
    this.albumLabel?.resumeScrolling();
  }

  render() {
    const metadata = this.mediaApp.metadata;
    const width = this.getTrackInformationWidth();
    const { title, artist, album } = readTrackInformation(metadata, {
      unknownArtist: _("Unknown artist"),
      unknownAlbum: _("Unknown album"),
    });
    const renderKey = [
      title,
      artist,
      album,
      width,
      this.extensionController.popupTrackInformationTitleShow,
      this.extensionController.popupTrackInformationArtistShow,
      this.extensionController.popupTrackInformationAlbumShow,
      this.extensionController.popupTrackInformationScrollEnabled,
      this.extensionController.popupTrackInformationScrollSpeed,
      this.extensionController.popupTrackInformationScrollPauseMilliseconds,
    ].join("\u0001");

    if (renderKey === this.renderKey) {
      this.attach();
      return;
    }
    this.renderKey = renderKey;
    this.ensureContainer(width);
    this.clearFields();

    const paused = this.mediaApp.playbackStatus !== PlaybackStatus.PLAYING;
    if (this.extensionController.popupTrackInformationTitleShow) {
      this.titleLabel = this.createLabel(
        title,
        "mediashell-popup-track-information-title",
        width,
        paused,
      );
    }
    if (this.extensionController.popupTrackInformationArtistShow) {
      this.artistLabel = this.createLabel(
        artist,
        "mediashell-popup-track-information-artist",
        width,
        paused,
        Clutter.TimelineDirection.BACKWARD,
      );
    }
    if (this.extensionController.popupTrackInformationAlbumShow) {
      this.albumLabel = this.createLabel(
        album,
        "mediashell-popup-track-information-album",
        width,
        paused,
      );
    }

    const labels = [this.titleLabel, this.artistLabel, this.albumLabel].filter(
      Boolean,
    );
    if (labels.length === 0) {
      this.trackInformationBox
        .get_parent()
        ?.remove_child(this.trackInformationBox);
      return;
    }
    for (const label of labels) this.trackInformationBox.add_child(label);
    this.attach();
  }

  ensureContainer(width) {
    if (!this.trackInformationBox) {
      this.trackInformationBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        styleClass: "mediashell-popup-track-information",
      });
    }
    const widthStyle = this.buildFixedWidthStyle(width);
    this.trackInformationBox.width = width;
    this.trackInformationBox.style = widthStyle;
    this.trackInformationBox.xExpand = true;
    this.trackInformationBox.xAlign = Clutter.ActorAlign.FILL;
  }

  createLabel(
    text,
    styleClass,
    width,
    isPaused,
    direction = Clutter.TimelineDirection.FORWARD,
  ) {
    const label = new ScrollingLabel({
      text,
      isScrolling: this.extensionController.popupTrackInformationScrollEnabled,
      isPaused,
      direction,
      width,
      scrollSpeed: this.extensionController.popupTrackInformationScrollSpeed,
      scrollPauseMilliseconds:
        this.extensionController.popupTrackInformationScrollPauseMilliseconds,
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

  clearFields() {
    for (const label of [this.titleLabel, this.artistLabel, this.albumLabel]) {
      label?.get_parent()?.remove_child(label);
      label?.destroy();
    }
    this.titleLabel = null;
    this.artistLabel = null;
    this.albumLabel = null;
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
    this.clearFields();
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
    this.titleLabel = null;
    this.artistLabel = null;
    this.albumLabel = null;
    this.renderKey = null;
    this.popupContent = null;
  }
}
