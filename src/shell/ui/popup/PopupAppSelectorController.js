// Coordinates the active-app selector button with its lazily created app list.
import PopupAppSelectorButton from "./PopupAppSelectorButton.js";
import PopupAppSelectorList from "./PopupAppSelectorList.js";

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
