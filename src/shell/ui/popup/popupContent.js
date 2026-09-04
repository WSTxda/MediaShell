/**
 * @file popupContent.js
 * @module shell.ui.popup.popupContent
 *
 * Owns and incrementally reconciles the complete MediaShell popup surface.
 *
 * PopupContent owns every popup actor, its surface-local dirty regions, and the
 * idle source used to coalesce bursts. When the menu is closed it records dirty
 * regions without rendering, then merges them with the required initial regions
 * on the next open.
 */

import Clutter from "gi://Clutter";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { PlaybackControlSurfaces } from "../../../shared/playback/surfaces.js";
import { PlaybackStatus } from "../../mpris/protocol.js";
import { createLogger } from "../../../shared/logging/logger.js";
import { resolvePopupWidth } from "../../../shared/ui/popupLayout.js";
import { isPlaybackControlSurfaceVisible } from "../../media/playback/surfaceState.js";
import { POPUP_CONTAINER_PADDING } from "../../constants/popup.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import { styleClassNames } from "../../utils/styleClasses.js";
import CoalescedUpdateQueue from "../reconciliation/coalescedUpdateQueue.js";
import PopupAlbumArt from "./popupAlbumArt.js";
import PopupPlaybackControls from "./popupPlaybackControls.js";
import PopupMediaAppSelector from "./popupMediaAppSelector.js";
import PopupTrackInformation from "./popupTrackInformation.js";
import PopupProgressBar from "./popupProgressBar.js";
import PopupVolumeControl from "./popupVolumeControl.js";
import { PopupRegions } from "./regions.js";

const logger = createLogger("PopupContent");

/** Owns and reconciles every widget inside the MediaShell popup menu. */
export default class PopupContent {
  constructor(
    indicator,
    { artworkService, desktopAppResolver, playbackController },
  ) {
    this.indicator = indicator;
    this.pendingClosedRegions = 0;
    this.appliedPopupOuterWidth = null;
    this.updateQueue = new CoalescedUpdateQueue(
      (regions) => this.reconcile(regions),
      (error) =>
        logger.errorOnce(
          "deferred-surface-update",
          "Deferred popup reconciliation failed",
          error,
        ),
    );
    this.popupItem = new PopupMenu.PopupBaseMenuItem({
      style_class: styleClassNames(
        StyleClasses.NO_PADDING,
        StyleClasses.POPUP_BOX,
      ),
      activate: false,
    });
    this.popupItem.set_orientation(Clutter.Orientation.VERTICAL);
    this.popupItem.remove_style_class_name(StyleClasses.POPUP_MENU_ITEM);

    this.mediaAppSelector = new PopupMediaAppSelector(
      this,
      desktopAppResolver,
    );
    this.albumArt = new PopupAlbumArt(this, artworkService);
    this.trackInformation = new PopupTrackInformation(this);
    this.progressBar = new PopupProgressBar(this, playbackController);
    this.playbackControls = new PopupPlaybackControls(this, playbackController);
    this.volumeControl = new PopupVolumeControl(this, playbackController);

    this.menu.addMenuItem(this.popupItem);
    this.popupItemCapturedEventId = this.popupItem.connect(
      "captured-event",
      (_actor, event) =>
        this.mediaAppSelector.handleCapturedEvent(event),
    );
    this.menuOpenSignalId = this.menu.connect(
      "open-state-changed",
      (_menu, isOpen) => this.handleOpenStateChanged(isOpen),
    );
  }

  get extensionController() {
    return this.indicator.extensionController;
  }
  get mediaRuntime() {
    return this.indicator.mediaRuntime;
  }
  get mediaApp() {
    return this.indicator.mediaApp;
  }
  get menu() {
    return this.indicator.menu;
  }

  requestUpdate(regions) {
    this.updateQueue?.request(regions & PopupRegions.ALL);
  }

  resetPendingUpdates() {
    this.updateQueue?.cancel();
    this.pendingClosedRegions = 0;
  }

  handleOpenStateChanged(isOpen) {
    if (isOpen) {
      let regions =
        this.pendingClosedRegions |
        PopupRegions.MEDIA_APP_SELECTOR |
        PopupRegions.ARTWORK |
        PopupRegions.TRACK_INFORMATION |
        PopupRegions.PLAYBACK_CONTROLS;
      if (this.extensionController.popupProgressBarShow)
        regions |= PopupRegions.PROGRESS;
      if (this.extensionController.popupVolumeControlShow)
        regions |= PopupRegions.VOLUME;

      // Opening is already a synchronous Shell transition. Cancel any queued
      // idle pass and reconcile the accumulated state once against current data.
      this.updateQueue.cancel();
      this.pendingClosedRegions = 0;
      this.reconcile(regions, true);
      this.syncProgressBarPlaybackState();
      return;
    }

    this.mediaAppSelector.close();
    this.albumArt.cancelAlbumArtLoad();
    this.progressBar.pause();
  }

  isActiveMediaApp(mediaApp) {
    return this.indicator.isActiveMediaApp(mediaApp);
  }

  selectMediaApp(mediaApp) {
    return this.mediaRuntime?.selectPlayer(mediaApp) ?? false;
  }

  toggleMediaAppPin(mediaApp) {
    const pinStateChanged = this.mediaRuntime?.togglePlayerPin(mediaApp) ?? false;
    if (pinStateChanged) this.requestUpdate(PopupRegions.MEDIA_APP_SELECTOR);
    return pinStateChanged;
  }

  reconcile(regions, forceRender = false) {
    const popupRegions = regions & PopupRegions.ALL;
    if (!popupRegions || !this.indicator) return;

    // Preserve the 2.x behavior where popup geometry is kept current even when
    // rendering is deferred while the menu is closed.
    this.syncPopupSize();
    if (!forceRender && !this.menu.isOpen) {
      this.pendingClosedRegions |= popupRegions;
      return;
    }

    if (popupRegions & PopupRegions.MEDIA_APP_SELECTOR) {
      this.runComponentUpdate("media app selector", () =>
        this.mediaAppSelector.render(),
      );
    }

    if (popupRegions & PopupRegions.ARTWORK) {
      this.runComponentUpdate("album art", () => {
        if (this.extensionController.popupAlbumArtShow)
          return this.albumArt.render();
        this.albumArt.remove();
        return null;
      });
    }

    if (popupRegions & PopupRegions.TRACK_INFORMATION) {
      this.runComponentUpdate("track information", () => {
        if (this.extensionController.popupTrackInformationShow)
          return this.trackInformation.render();
        this.trackInformation.remove();
        return null;
      });
    }

    if (popupRegions & PopupRegions.PROGRESS) {
      this.runComponentUpdate("progress bar", () => {
        if (this.extensionController.popupProgressBarShow)
          return this.progressBar.render();
        this.progressBar.remove();
        return null;
      });
    }

    if (popupRegions & PopupRegions.PLAYBACK_CONTROLS) {
      this.runComponentUpdate("playback controls", () => {
        if (
          isPlaybackControlSurfaceVisible(
            this.extensionController,
            PlaybackControlSurfaces.POPUP,
          )
        )
          return this.playbackControls.render(popupRegions);
        this.playbackControls.remove();
        return null;
      });
    }

    if (popupRegions & PopupRegions.VOLUME) {
      this.runComponentUpdate("volume control", () => {
        if (this.extensionController.popupVolumeControlShow)
          return this.volumeControl.render();
        this.volumeControl.remove();
        return null;
      });
    }

    if (this.extensionController.popupVolumeControlShow)
      this.volumeControl.reconcilePosition();
  }

  runComponentUpdate(componentName, update) {
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
      // A single malformed actor or third-party metadata value must not prevent
      // the remaining popup sections from reconciling.
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
      showTransportControls &&
        this.extensionController.popupPlaybackControlsPreviousTrackShow,
      showTransportControls &&
        this.extensionController.popupPlaybackControlsNextTrackShow,
    );
  }

  getPopupContentWidth() {
    return this.getPopupOuterWidth() - POPUP_CONTAINER_PADDING * 2;
  }

  getAlbumArtWidth() {
    return this.getPopupContentWidth();
  }

  syncPopupSize() {
    if (!this.popupItem) return;

    const width = this.getPopupOuterWidth();
    if (width === this.appliedPopupOuterWidth) return;
    this.appliedPopupOuterWidth = width;
    this.popupItem.style = this.buildFixedWidthStyle(width);
    this.mediaAppSelector.syncMediaAppSelectorWidth();
  }

  destroy() {
    const indicator = this.indicator;
    if (!indicator) return;

    this.updateQueue?.destroy();
    this.updateQueue = null;
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
    const mediaAppSelector = this.mediaAppSelector;
    const popupItem = this.popupItem;
    this.progressBar = null;
    this.trackInformation = null;
    this.playbackControls = null;
    this.volumeControl = null;
    this.albumArt = null;
    this.mediaAppSelector = null;
    this.popupItem = null;

    progressBar?.destroy();
    trackInformation?.destroy();
    playbackControls?.destroy();
    volumeControl?.destroy();
    albumArt?.destroy();
    mediaAppSelector?.destroy();
    popupItem?.destroy();

    this.pendingClosedRegions = 0;
    this.appliedPopupOuterWidth = null;
  }
}
