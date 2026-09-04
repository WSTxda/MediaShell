/**
 * @file popupMediaAppSelector.js
 * @module shell.ui.popup.popupMediaAppSelector
 *
 * Owns the popup media-app selector button/list composition and interaction.
 *
 * PopupContent delegates selector state to this component so its list can be
 * reconciled independently from album art, progress, and playback controls.
 */

import PopupMediaAppSelectorButton from "./popupMediaAppSelectorButton.js";
import PopupMediaAppSelectorList from "./popupMediaAppSelectorList.js";

/**
 * Owns the popup media-app selector button/list composition and interaction.
 */
export default class PopupMediaAppSelector {
  constructor(popupContent, desktopAppResolver) {
    this.popupContent = popupContent;
    this.mediaAppSelectorButton = new PopupMediaAppSelectorButton(
      popupContent,
      desktopAppResolver,
      () => this.mediaAppSelectorList.toggle(),
    );
    this.mediaAppSelectorList = new PopupMediaAppSelectorList(
      popupContent,
      this.mediaAppSelectorButton,
      desktopAppResolver,
    );
  }

  get actor() {
    return this.mediaAppSelectorButton.actor;
  }

  render() {
    this.mediaAppSelectorButton.render();
    const availableMediaAppCount =
      (this.popupContent.mediaRuntime?.getAvailablePlayers() ?? []).length;
    if (availableMediaAppCount <= 1) this.mediaAppSelectorList.close();
    else if (this.mediaAppSelectorList.isOpen)
      this.mediaAppSelectorList.refreshMediaApps();
  }

  close(animate = true) {
    this.mediaAppSelectorList.close(animate);
  }

  syncMediaAppSelectorWidth() {
    this.mediaAppSelectorList.syncMediaAppSelectorListWidth();
  }

  handleCapturedEvent(event) {
    return this.mediaAppSelectorList.handleCapturedEvent(event);
  }

  destroy() {
    this.mediaAppSelectorList.destroy();
    this.mediaAppSelectorButton.destroy();
    this.mediaAppSelectorList = null;
    this.mediaAppSelectorButton = null;
    this.popupContent = null;
  }
}
