/**
 * @file PopupContent.js
 * @module shell.ui.popup.PopupContent
 *
 * Orchestrates every widget inside the MediaShell popup.
 *
 * PopupContent owns album art, track information, playback controls, the progress
 * bar, volume control, and media app selector components for the active media app.
 * It applies WidgetFlags immediately while open and accumulates affected regions
 * while closed.
 * MediaShellIndicator owns idle coalescing for bursts of MPRIS changes.
 */

import Clutter from "gi://Clutter";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { PlaybackControlSurfaces } from "../../../shared/constants/playbackControlSurfaces.js";
import { PlaybackStatus } from "../../../shared/enums/playback.js";
import { WidgetFlags } from "../../../shared/enums/widgetFlags.js";
import { createLogger } from "../../../shared/utils/log.js";
import { resolvePopupWidth } from "../../../shared/utils/popupLayout.js";
import { isPlaybackControlSurfaceVisible } from "../../../shared/utils/playbackControlSurfaceState.js";
import { POPUP_CONTAINER_PADDING } from "../../constants/popup.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import { styleClassNames } from "../../utils/styleClasses.js";
import PopupAlbumArt from "./PopupAlbumArt.js";
import PopupPlaybackControls from "./PopupPlaybackControls.js";
import PopupMediaAppSelectorController from "./PopupMediaAppSelectorController.js";
import PopupTrackInformation from "./PopupTrackInformation.js";
import PopupProgressBar from "./PopupProgressBar.js";
import PopupVolumeControl from "./PopupVolumeControl.js";

const logger = createLogger("PopupContent");

/**
 * Orchestrates every widget inside the MediaShell popup menu.
 */
export default class PopupContent {
  constructor(indicator) {
    this.indicator = indicator;
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

    this.mediaAppSelectorController = new PopupMediaAppSelectorController(this);
    this.albumArt = new PopupAlbumArt(this);
    this.trackInformation = new PopupTrackInformation(this);
    this.progressBar = new PopupProgressBar(this);
    this.playbackControls = new PopupPlaybackControls(this);
    this.volumeControl = new PopupVolumeControl(this);

    this.menu.addMenuItem(this.popupItem);
    this.popupItemCapturedEventId = this.popupItem.connect(
      "captured-event",
      (_actor, event) =>
        this.mediaAppSelectorController.handleCapturedEvent(event),
    );
    this.menuOpenSignalId = this.menu.connect(
      "open-state-changed",
      (_menu, isOpen) => {
        if (isOpen) {
          let widgetFlags =
            this.pendingWidgetFlags |
            WidgetFlags.POPUP_MEDIA_APP_SELECTOR |
            WidgetFlags.POPUP_ALBUM_ART |
            WidgetFlags.POPUP_TRACK_INFORMATION |
            WidgetFlags.POPUP_PLAYBACK_CONTROLS;
          if (this.extensionController.popupProgressBarShow)
            widgetFlags |= WidgetFlags.POPUP_PROGRESS_BAR;
          if (this.extensionController.popupVolumeControlShow)
            widgetFlags |= WidgetFlags.POPUP_VOLUME_CONTROL;
          this.pendingWidgetFlags = 0;
          this.updateWidgets(widgetFlags, true);
          this.syncProgressBarPlaybackState();
        } else {
          this.mediaAppSelectorController.close();
          this.albumArt.cancelAlbumArtLoad();
          this.progressBar.pause();
        }
      },
    );
  }

  get extensionController() {
    return this.indicator.extensionController;
  }
  get mediaApp() {
    return this.indicator.mediaApp;
  }
  get menu() {
    return this.indicator.menu;
  }

  isActiveMediaApp(mediaApp) {
    return this.indicator.isActiveMediaApp(mediaApp);
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

    if (popupFlags & WidgetFlags.POPUP_MEDIA_APP_SELECTOR) {
      this.runWidgetUpdate("media app selector", () =>
        this.mediaAppSelectorController.render(),
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

    if (popupFlags & WidgetFlags.POPUP_VOLUME_CONTROL) {
      this.runWidgetUpdate("volume control", () => {
        if (this.extensionController.popupVolumeControlShow)
          return this.volumeControl.render();
        this.volumeControl.remove();
        return null;
      });
    }

    if (this.extensionController.popupVolumeControlShow)
      this.volumeControl.reconcilePosition();
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
    this.mediaAppSelectorController.syncMediaAppSelectorWidth();
  }

  destroy() {
    const indicator = this.indicator;
    if (!indicator) return;
    this.indicator = null;

    const menu = indicator.menu;
    if (this.menuOpenSignalId !== null) menu.disconnect(this.menuOpenSignalId);
    if (this.popupItem && this.popupItemCapturedEventId !== null)
      this.popupItem.disconnect(this.popupItemCapturedEventId);
    this.menuOpenSignalId = null;
    this.popupItemCapturedEventId = null;

    const progressBar = this.progressBar;
    const trackInformation = this.trackInformation;
    const playbackControls = this.playbackControls;
    const volumeControl = this.volumeControl;
    const albumArt = this.albumArt;
    const mediaAppSelectorController = this.mediaAppSelectorController;
    const popupItem = this.popupItem;
    this.progressBar = null;
    this.trackInformation = null;
    this.playbackControls = null;
    this.volumeControl = null;
    this.albumArt = null;
    this.mediaAppSelectorController = null;
    this.popupItem = null;

    progressBar?.destroy();
    trackInformation?.destroy();
    playbackControls?.destroy();
    volumeControl?.destroy();
    albumArt?.destroy();
    mediaAppSelectorController?.destroy();
    popupItem?.destroy();

    this.pendingWidgetFlags = 0;
    this.appliedPopupOuterWidth = null;
  }
}
