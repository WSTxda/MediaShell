/**
 * @file PopupAppSelectorController.js
 * @module shell.ui.popup.PopupAppSelectorController
 *
 * Coordinates popup media-app selector visibility and selection events.
 *
 * PopupContent delegates selector state to this controller so the list can be
 * rebuilt independently from album art, the Progress Bar, and playback controls.
 * It owns the selector list instance and forwards user choices to ExtensionController.
 */

import PopupAppSelectorButton from "./PopupAppSelectorButton.js";
import PopupAppSelectorList from "./PopupAppSelectorList.js";

/**
 * Coordinates popup media-app selector visibility and selection events.
 */
export default class PopupAppSelectorController {
    constructor(popupContent) {
        this.popupContent = popupContent;
        this.appSelectorButton = new PopupAppSelectorButton(popupContent, () => this.appSelectorList.toggle());
        this.appSelectorList = new PopupAppSelectorList(popupContent, this.appSelectorButton);
    }

    get actor() {
        return this.appSelectorButton.actor;
    }

    render() {
        this.appSelectorButton.render();
        if (this.popupContent.extensionController.getMediaApps().length <= 1) this.appSelectorList.close();
        else if (this.appSelectorList.isOpen) this.appSelectorList.refreshMediaApps();
    }

    close(animate = true) {
        this.appSelectorList.close(animate);
    }

    syncAppSelectorWidth() {
        this.appSelectorList.syncAppSelectorListWidth();
    }

    handleCapturedEvent(event) {
        return this.appSelectorList.handleCapturedEvent(event);
    }

    destroy() {
        this.appSelectorList.destroy();
        this.appSelectorButton.destroy();
        this.appSelectorList = null;
        this.appSelectorButton = null;
        this.popupContent = null;
    }
}
