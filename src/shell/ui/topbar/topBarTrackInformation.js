/**
 * @file topBarTrackInformation.js
 * @module shell.ui.topbar.topBarTrackInformation
 *
 * Renders configurable track information inside the GNOME top bar.
 *
 * TopBarSurface owns this component and passes the ordered track-information fields chosen
 * in preferences. It uses ScrollingLabel for long text and the canonical Track presentation
 * helper for field assembly. TopBarSurface owns layout orchestration, while this
 * component preserves the original track-information width and Lock width contract.
 */

import { MediaShellStyleClasses } from "../style.js";
import { buildTrackInformationText } from "../../media/track/presentation.js";
import { placeActorAtIndex } from "../components/actorOrder.js";
import ScrollingLabel from "../components/scrollingLabel.js";

/**
 * Renders configurable track information inside the GNOME top bar.
 */
export default class TopBarTrackInformation {
  constructor(topBarSurface) {
    this.topBarSurface = topBarSurface;
    this.actor = null;
    this.renderKey = null;
    this.width = normalizeWidth(this.settings.trackInformationWidth);
    this.isFixedWidth = Boolean(this.settings.trackInformationWidthLock);
  }

  get settings() {
    return this.topBarSurface.settings;
  }

  get player() {
    return this.topBarSurface.player;
  }

  render(index, parentBox) {
    const text = buildTrackInformationText(
      this.player.track,
      this.settings.trackInformationContent,
    );
    const renderKey = [
      text,
      this.width,
      this.isFixedWidth,
      this.settings.trackInformationScrollEnabled,
      this.settings.trackInformationScrollSpeed,
      this.settings.trackInformationScrollPauseMilliseconds,
    ].join("\u0001");

    if (this.actor && renderKey === this.renderKey) {
      this.attach(index, parentBox);
      return;
    }

    const label = new ScrollingLabel({
      text,
      width: this.width,
      isFixedWidth: this.isFixedWidth,
      isScrolling: this.settings.trackInformationScrollEnabled,
      scrollSpeed: this.settings.trackInformationScrollSpeed,
      scrollPauseMilliseconds:
        this.settings.trackInformationScrollPauseMilliseconds,
    });

    label.add_style_class_name(
      MediaShellStyleClasses.TOP_BAR_TRACK_INFORMATION,
    );

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
    this.topBarSurface = null;
  }
}

function normalizeWidth(width) {
  const numericWidth = Number(width);
  return Number.isFinite(numericWidth)
    ? Math.max(0, Math.ceil(numericWidth))
    : 0;
}
