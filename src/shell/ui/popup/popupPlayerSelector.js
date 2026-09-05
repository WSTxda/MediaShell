/**
 * @file popupPlayerSelector.js
 * @module shell.ui.popup.popupPlayerSelector
 *
 * Owns the popup player selector button/list composition and interaction.
 *
 * PopupSurface delegates selector state to this component so its list can be
 * reconciled independently from artwork, progress, and playback controls.
 */

import PopupPlayerSelectorButton from "./popupPlayerSelectorButton.js";
import PopupPlayerSelectorList from "./popupPlayerSelectorList.js";

/**
 * Owns the popup player selector button/list composition and interaction.
 */
export default class PopupPlayerSelector {
  constructor(popupSurface, desktopAppResolver) {
    this.popupSurface = popupSurface;
    this.playerSelectorButton = new PopupPlayerSelectorButton(
      popupSurface,
      desktopAppResolver,
      () => this.playerSelectorList.toggle(),
    );
    this.playerSelectorList = new PopupPlayerSelectorList(
      popupSurface,
      this.playerSelectorButton,
      desktopAppResolver,
    );
  }

  get actor() {
    return this.playerSelectorButton.actor;
  }

  render() {
    this.playerSelectorButton.render();
    const availablePlayerCount = (
      this.popupSurface.mediaRuntime?.getAvailablePlayers() ?? []
    ).length;
    if (availablePlayerCount <= 1) this.playerSelectorList.close();
    else if (this.playerSelectorList.isOpen)
      this.playerSelectorList.refreshPlayers();
  }

  close(animate = true) {
    this.playerSelectorList.close(animate);
  }

  syncPlayerSelectorWidth() {
    this.playerSelectorList.syncPlayerSelectorListWidth();
  }

  handleCapturedEvent(event) {
    return this.playerSelectorList.handleCapturedEvent(event);
  }

  destroy() {
    this.playerSelectorList.destroy();
    this.playerSelectorButton.destroy();
    this.playerSelectorList = null;
    this.playerSelectorButton = null;
    this.popupSurface = null;
  }
}
