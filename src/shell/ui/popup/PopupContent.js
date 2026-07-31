/**
 * @file PopupContent.js
 * @module shell.ui.popup.PopupContent
 *
 * Orchestrates every widget inside the MediaShell popup.
 *
 * PopupContent owns album art, track information, playback controls, the progress
 * bar, and app selector components for the active media app. It applies WidgetFlags
 * immediately while open and accumulates affected regions while closed.
 * TopBarButton owns idle coalescing for bursts of MPRIS changes.
 */

import Clutter from "gi://Clutter";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { PlaybackControlSurfaces } from "../../../shared/constants/playbackControlSurfaces.js";
import { PlaybackStatus } from "../../../shared/enums/playback.js";
import { WidgetFlags } from "../../../shared/enums/widget.js";
import { createLogger } from "../../../shared/utils/log.js";
import { resolvePopupWidth } from "../../../shared/utils/popupLayout.js";
import { isPlaybackControlSurfaceVisible } from "../../../shared/utils/playbackControlSurfaceState.js";
import { POPUP_CONTAINER_PADDING } from "../../constants/popup.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import { styleClassNames } from "../../utils/styleClasses.js";
import PopupAlbumArt from "./PopupAlbumArt.js";
import PopupPlaybackControls from "./PopupPlaybackControls.js";
import PopupAppSelectorController from "./PopupAppSelectorController.js";
import PopupTrackInformation from "./PopupTrackInformation.js";
import PopupProgressBar from "./PopupProgressBar.js";

const logger = createLogger("PopupContent");

/**
 * Orchestrates every widget inside the MediaShell popup menu.
 */
export default class PopupContent {
  constructor(topBarButton) {
    this.topBarButton = topBarButton;
    this.pendingWidgetFlags = 0;
    this.appliedPopupOuterWidth = null;
    this.popupItem = new PopupMenu.PopupBaseMenuItem({
      style_class: styleClassNames(
        StyleClasses.NO_PADDING,
        StyleClasses.POPUP_BOX,
      ),
      activate: false,
    });
    this.popupItem.set_orientation(Clutter.Orientation.VERTICAL);
    this.popupItem.remove_style_class_name(StyleClasses.POPUP_MENU_ITEM);

    this.appSelectorController = new PopupAppSelectorController(this);
    this.albumArt = new PopupAlbumArt(this);
    this.trackInformation = new PopupTrackInformation(this);
    this.progressBar = new PopupProgressBar(this);
    this.playbackControls = new PopupPlaybackControls(this);

    this.menu.addMenuItem(this.popupItem);
    this.popupItemCapturedEventId = this.popupItem.connect(
      "captured-event",
      (_actor, event) => this.appSelectorController.handleCapturedEvent(event),
    );
    this.menuOpenSignalId = this.menu.connect(
      "open-state-changed",
      (_menu, isOpen) => {
        if (isOpen) {
          let widgetFlags =
            this.pendingWidgetFlags |
            WidgetFlags.POPUP_APP_SELECTOR |
            WidgetFlags.POPUP_ALBUM_ART |
            WidgetFlags.POPUP_TRACK_INFORMATION |
            WidgetFlags.POPUP_PLAYBACK_CONTROLS;
          if (this.extensionController.popupProgressBarShow)
            widgetFlags |= WidgetFlags.POPUP_PROGRESS_BAR;
          this.pendingWidgetFlags = 0;
          this.updateWidgets(widgetFlags, true);
          this.syncProgressBarPlaybackState();
        } else {
          this.appSelectorController.close();
          this.albumArt.cancelAlbumArtLoad();
          this.progressBar.pause();
        }
      },
    );
  }

  get extensionController() {
    return this.topBarButton.extensionController;
  }
  get mediaApp() {
    return this.topBarButton.mediaApp;
  }
  get menu() {
    return this.topBarButton.menu;
  }

  isActiveMediaApp(mediaApp) {
    return this.topBarButton.isActiveMediaApp(mediaApp);
  }

  selectMediaApp(mediaApp) {
    return this.extensionController.selectMediaApp(mediaApp);
  }

  toggleMediaAppPin(mediaApp) {
    return this.extensionController.toggleMediaAppPin(mediaApp);
  }

  updateWidgets(widgetFlags, forceRender = false) {
    const popupFlags = widgetFlags & WidgetFlags.POPUP;
    if (popupFlags === 0) return;

    this.applyPopupSize();
    if (!forceRender && !this.menu.isOpen) {
      this.pendingWidgetFlags |= popupFlags;
      return;
    }

    if (popupFlags & WidgetFlags.POPUP_APP_SELECTOR) {
      this.runWidgetUpdate("app selector", () =>
        this.appSelectorController.render(),
      );
    }

    if (popupFlags & WidgetFlags.POPUP_ALBUM_ART) {
      this.runWidgetUpdate("album art", () => {
        if (this.extensionController.popupAlbumArtShow)
          return this.albumArt.render();
        this.albumArt.remove();
        return null;
      });
    }

    if (popupFlags & WidgetFlags.POPUP_TRACK_INFORMATION) {
      this.runWidgetUpdate("track information", () => {
        if (this.extensionController.popupTrackInformationShow)
          return this.trackInformation.render();
        this.trackInformation.remove();
        return null;
      });
    }

    if (popupFlags & WidgetFlags.POPUP_PROGRESS_BAR) {
      this.runWidgetUpdate("progress bar", () => {
        if (this.extensionController.popupProgressBarShow)
          return this.progressBar.render();
        this.progressBar.remove();
        return null;
      });
    }

    if (popupFlags & WidgetFlags.POPUP_PLAYBACK_CONTROLS) {
      this.runWidgetUpdate("playback controls", () => {
        if (
          isPlaybackControlSurfaceVisible(
            this.extensionController,
            PlaybackControlSurfaces.POPUP,
          )
        )
          return this.playbackControls.render(popupFlags);
        this.playbackControls.remove();
        return null;
      });
    }
  }

  runWidgetUpdate(componentName, update) {
    try {
      const result = update();
      result?.catch?.((error) =>
        logger.errorOnce(
          `component-update:${componentName}`,
          `Popup ${componentName} update failed`,
          error,
        ),
      );
    } catch (error) {
      // A single malformed actor or third-party metadata value must not
      // prevent the remaining popup sections from reconciling.
      logger.errorOnce(
        `component-update:${componentName}`,
        `Popup ${componentName} update failed`,
        error,
      );
    }
  }

  syncProgressBarPlaybackState() {
    if (
      !this.menu.isOpen ||
      this.mediaApp.playbackStatus !== PlaybackStatus.PLAYING
    ) {
      this.progressBar.pause();
      return;
    }
    this.progressBar.resume();
  }

  setPlaybackRate(playbackRate) {
    this.progressBar.setPlaybackRate(playbackRate);
  }

  setPlaybackPosition(positionMicroseconds) {
    this.progressBar.setPlaybackPosition(positionMicroseconds);
  }

  syncAlbumArtPlaybackState() {
    if (!this.menu.isOpen || !this.extensionController.popupAlbumArtShow)
      return;
    this.albumArt.syncPlaybackState(this.mediaApp.playbackStatus);
  }

  buildFixedWidthStyle(width) {
    return [
      `width: ${width}px;`,
      `min-width: ${width}px;`,
      `max-width: ${width}px;`,
    ].join(" ");
  }

  getTrackInformationWidth() {
    return this.getPopupContentWidth();
  }

  getPopupOuterWidth() {
    const showTransportControls =
      this.extensionController.popupPlaybackControlsShow;
    return resolvePopupWidth(
      this.extensionController.popupWidth,
      showTransportControls &&
        this.extensionController.popupPlaybackControlsSeekBackwardShow,
      showTransportControls &&
        this.extensionController.popupPlaybackControlsSeekForwardShow,
    );
  }

  getPopupContentWidth() {
    return this.getPopupOuterWidth() - POPUP_CONTAINER_PADDING * 2;
  }

  getAlbumArtWidth() {
    return this.getPopupContentWidth();
  }

  applyPopupSize() {
    if (!this.popupItem) return;

    const width = this.getPopupOuterWidth();
    if (width === this.appliedPopupOuterWidth) return;
    this.appliedPopupOuterWidth = width;
    this.popupItem.style = this.buildFixedWidthStyle(width);
    this.appSelectorController.syncAppSelectorWidth();
  }

  destroy() {
    if (!this.topBarButton) return;

    for (const [object, signalId] of [
      [this.menu, this.menuOpenSignalId],
      [this.popupItem, this.popupItemCapturedEventId],
    ]) {
      if (!object || signalId === null) continue;
      try {
        object.disconnect(signalId);
      } catch {
        // PopupMenu may dispose child handlers before MediaShell teardown.
      }
    }
    this.menuOpenSignalId = null;
    this.popupItemCapturedEventId = null;

    for (const property of [
      "progressBar",
      "trackInformation",
      "playbackControls",
      "albumArt",
      "appSelectorController",
      "popupItem",
    ]) {
      const component = this[property];
      this[property] = null;
      try {
        component?.destroy();
      } catch (error) {
        logger.error(`Failed to destroy ${property}`, error);
      }
    }
    this.pendingWidgetFlags = 0;
    this.appliedPopupOuterWidth = null;
    this.topBarButton = null;
  }
}
