/**
 * @file TopBarTrackInformation.js
 * @module shell.ui.topBar.TopBarTrackInformation
 *
 * Renders configurable track metadata inside the GNOME top bar.
 *
 * TopBarContent owns this component and passes the ordered metadata fields chosen
 * in preferences. It uses ScrollingLabel for long text and shared metadata
 * helpers for field assembly. TopBarContent owns layout orchestration, while this
 * component preserves the original metadata width and Lock width contract.
 */

import { buildTrackInformationText } from "../../../shared/utils/metadata.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import { placeActorAtIndex } from "../../utils/actors.js";
import ScrollingLabel from "../ScrollingLabel.js";

/**
 * Renders configurable track metadata inside the GNOME top bar.
 */
export default class TopBarTrackInformation {
  constructor(topBarContent) {
    this.topBarContent = topBarContent;
    this.actor = null;
    this.renderKey = null;
    this.width = normalizeWidth(
      this.extensionController.topBarTrackInformationWidth,
    );
    this.isFixedWidth = Boolean(
      this.extensionController.topBarTrackInformationWidthLock,
    );
  }

  get extensionController() {
    return this.topBarContent.extensionController;
  }

  get mediaApp() {
    return this.topBarContent.mediaApp;
  }

  render(index, parentBox) {
    const text = buildTrackInformationText(
      this.mediaApp.metadata,
      this.extensionController.topBarTrackInformationContent,
    );
    const renderKey = [
      text,
      this.width,
      this.isFixedWidth,
      this.extensionController.topBarTrackInformationScrollEnabled,
      this.extensionController.topBarTrackInformationScrollSpeed,
      this.extensionController.topBarTrackInformationScrollPauseMilliseconds,
    ].join("\u0001");

    if (this.actor && renderKey === this.renderKey) {
      this.attach(index, parentBox);
      return;
    }

    const label = new ScrollingLabel({
      text,
      width: this.width,
      isFixedWidth: this.isFixedWidth,
      isScrolling: this.extensionController.topBarTrackInformationScrollEnabled,
      scrollSpeed: this.extensionController.topBarTrackInformationScrollSpeed,
      scrollPauseMilliseconds:
        this.extensionController.topBarTrackInformationScrollPauseMilliseconds,
    });

    label.add_style_class_name(StyleClasses.TOP_BAR_TRACK_INFORMATION);

    const oldLabel = this.actor;
    this.actor = label;
    this.renderKey = renderKey;
    this.attach(index, parentBox);
    oldLabel?.destroy();
  }

  setWidth(width, isFixedWidth) {
    const normalizedWidth = normalizeWidth(width);
    const normalizedFixedWidth = Boolean(isFixedWidth);
    if (
      normalizedWidth === this.width &&
      normalizedFixedWidth === this.isFixedWidth
    )
      return;

    this.width = normalizedWidth;
    this.isFixedWidth = normalizedFixedWidth;
    const parentBox = this.actor?.get_parent();
    if (!parentBox) return;

    const index = parentBox.get_children().indexOf(this.actor);
    this.render(Math.max(0, index), parentBox);
  }

  attach(index, parentBox) {
    placeActorAtIndex(this.actor, parentBox, index);
  }

  remove() {
    if (!this.actor) return;
    this.actor.get_parent()?.remove_child(this.actor);
    this.actor.destroy();
    this.actor = null;
    this.renderKey = null;
  }

  destroy() {
    this.remove();
    this.topBarContent = null;
  }
}

function normalizeWidth(width) {
  const numericWidth = Number(width);
  return Number.isFinite(numericWidth)
    ? Math.max(0, Math.ceil(numericWidth))
    : 0;
}
