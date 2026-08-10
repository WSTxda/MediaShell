/**
 * @file PopupMediaAppSelectorController.js
 * @module shell.ui.popup.PopupMediaAppSelectorController
 *
 * Coordinates popup media app selector visibility and selection events.
 *
 * PopupContent delegates selector state to this controller so the list can be
 * rebuilt independently from album art, the progress bar, and playback controls.
 * It owns the selector list instance and forwards user choices to ExtensionController.
 */

import PopupMediaAppSelectorButton from "./PopupMediaAppSelectorButton.js";
import PopupMediaAppSelectorList from "./PopupMediaAppSelectorList.js";

/**
 * Coordinates popup media app selector visibility and selection events.
 */
export default class PopupMediaAppSelectorController {
  constructor(popupContent) {
    this.popupContent = popupContent;
    this.mediaAppSelectorButton = new PopupMediaAppSelectorButton(
      popupContent,
      () => this.mediaAppSelectorList.toggle(),
    );
    this.mediaAppSelectorList = new PopupMediaAppSelectorList(
      popupContent,
      this.mediaAppSelectorButton,
    );
  }

  get actor() {
    return this.mediaAppSelectorButton.actor;
  }

  render() {
    this.mediaAppSelectorButton.render();
    const availableMediaAppCount =
      this.popupContent.extensionController.getAvailableMediaApps().length;
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
