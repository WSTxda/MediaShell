/**
 * @file TopBarTrackInformation.js
 * @module shell.ui.topBar.TopBarTrackInformation
 *
 * Renders configurable track metadata inside the GNOME top bar.
 *
 * TopBarButton owns this component and passes the ordered metadata fields chosen
 * in preferences. It uses ScrollingLabel for long text and shared metadata
 * helpers for field assembly. TopBarButton owns layout orchestration, while this
 * component preserves the original metadata width and Lock width contract.
 */

import { PlaybackStatus } from "../../../shared/enums/playback.js";
import { buildTrackInformationText } from "../../../shared/utils/metadata.js";
import { placeActorAtIndex } from "../../utils/actors.js";
import ScrollingLabel from "../ScrollingLabel.js";

/**
 * Renders configurable track metadata inside the GNOME top bar.
 */
export default class TopBarTrackInformation {
  constructor(topBarButton) {
    this.topBarButton = topBarButton;
    this.actor = null;
    this.renderKey = null;
    this.width = normalizeWidth(
      topBarButton.extensionController.topBarTrackInformationWidth,
    );
    this.isFixedWidth = Boolean(
      topBarButton.extensionController.topBarTrackInformationWidthLock,
    );
  }

  render(index, parentBox) {
    const text = this.buildTrackInformationText();
    const renderKey = [
      text,
      this.width,
      this.isFixedWidth,
      this.topBarButton.extensionController.topBarTrackInformationScrollEnabled,
      this.topBarButton.extensionController.topBarTrackInformationScrollSpeed,
      this.topBarButton.extensionController
        .topBarTrackInformationScrollPauseMilliseconds,
    ].join("\u0001");

    if (this.actor && renderKey === this.renderKey) {
      this.attach(index, parentBox);
      return;
    }

    const label = new ScrollingLabel({
      text,
      width: this.width,
      isFixedWidth: this.isFixedWidth,
      isScrolling:
        this.topBarButton.extensionController
          .topBarTrackInformationScrollEnabled,
      isPaused:
        this.topBarButton.mediaApp.playbackStatus !== PlaybackStatus.PLAYING,
      scrollSpeed:
        this.topBarButton.extensionController.topBarTrackInformationScrollSpeed,
      scrollPauseMilliseconds:
        this.topBarButton.extensionController
          .topBarTrackInformationScrollPauseMilliseconds,
    });

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

  pause() {
    this.actor?.pauseScrolling();
  }

  resume() {
    this.actor?.resumeScrolling();
  }

  buildTrackInformationText() {
    return buildTrackInformationText(
      this.topBarButton.mediaApp.metadata,
      this.topBarButton.extensionController.topBarTrackInformationContent,
    );
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
    this.topBarButton = null;
  }
}

function normalizeWidth(width) {
  const numericWidth = Number(width);
  return Number.isFinite(numericWidth)
    ? Math.max(0, Math.ceil(numericWidth))
    : 0;
}
