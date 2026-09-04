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

import {
  MediaShellStyleClasses,
  NativeStyleClasses,
  styleClassNames,
} from "../style.js";
import Clutter from "gi://Clutter";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { PlaybackControlSurfaces } from "../../../shared/playback/surfaces.js";
import { PlaybackStatus } from "../../mpris/protocol.js";
import { createLogger } from "../../../shared/logging/logger.js";
import { resolvePopupWidth } from "../../../shared/ui/popupLayout.js";
import { isPlaybackControlSurfaceVisible } from "../../media/playback/surfaceState.js";
import { POPUP_CONTAINER_PADDING } from "./presentation.js";
import CoalescedUpdateQueue from "../reconciliation/coalescedUpdateQueue.js";
import PopupArtwork from "./popupArtwork.js";
import PopupPlaybackControls from "./popupPlaybackControls.js";
import PopupPlayerSelector from "./popupPlayerSelector.js";
import PopupTrackInformation from "./popupTrackInformation.js";
import PopupProgressBar from "./popupProgressBar.js";
import PopupVolumeControl from "./popupVolumeControl.js";
import { PopupRegions } from "./regions.js";

const logger = createLogger("PopupContent");

/** Owns and reconciles every widget inside the MediaShell popup menu. */
export default class PopupContent {
  constructor(
    indicator,
    { artworkService, desktopAppResolver, playbackController, popupSettings },
  ) {
    this.indicator = indicator;
    this.settings = popupSettings;
    this.settingsSubscriptions = [];
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
        NativeStyleClasses.NO_PADDING,
        MediaShellStyleClasses.POPUP_BOX,
      ),
      activate: false,
    });
    this.popupItem.set_orientation(Clutter.Orientation.VERTICAL);
    this.popupItem.remove_style_class_name(NativeStyleClasses.POPUP_MENU_ITEM);

    this.playerSelector = new PopupPlayerSelector(this, desktopAppResolver);
    this.artwork = new PopupArtwork(this, artworkService);
    this.trackInformation = new PopupTrackInformation(this);
    this.progressBar = new PopupProgressBar(this, playbackController);
    this.playbackControls = new PopupPlaybackControls(this, playbackController);
    this.volumeControl = new PopupVolumeControl(this, playbackController);

    this.menu.addMenuItem(this.popupItem);
    this.popupItemCapturedEventId = this.popupItem.connect(
      "captured-event",
      (_actor, event) => this.playerSelector.handleCapturedEvent(event),
    );
    this.menuOpenSignalId = this.menu.connect(
      "open-state-changed",
      (_menu, isOpen) => this.handleOpenStateChanged(isOpen),
    );
    this.installSettingsSubscriptions();
  }

  get mediaRuntime() {
    return this.indicator.mediaRuntime;
  }
  get player() {
    return this.indicator.player;
  }
  get menu() {
    return this.indicator.menu;
  }

  installSettingsSubscriptions() {
    const subscriptions = [
      [
        ["width"],
        PopupRegions.ARTWORK |
          PopupRegions.TRACK_INFORMATION |
          PopupRegions.PROGRESS |
          PopupRegions.VOLUME,
      ],
      [
        ["artworkShow"],
        PopupRegions.ARTWORK |
          PopupRegions.TRACK_INFORMATION |
          PopupRegions.PROGRESS,
      ],
      [["artworkCornerRadius"], PopupRegions.ARTWORK],
      [
        [
          "trackInformationShow",
          "trackInformationContent",
          "trackInformationScrollEnabled",
          "trackInformationScrollSpeed",
          "trackInformationScrollPauseMilliseconds",
        ],
        PopupRegions.TRACK_INFORMATION,
      ],
      [["progressBarShow"], PopupRegions.PROGRESS],
      [["volumeControlShow"], PopupRegions.VOLUME],
      [["appIconUseColor"], PopupRegions.PLAYER_SELECTOR],
      [["playbackControlsShow"], PopupRegions.PLAYBACK_CONTROLS],
      [["playbackControlsShuffleShow"], PopupRegions.PLAYBACK_SHUFFLE],
      [
        ["playbackControlsSeekBackwardShow"],
        PopupRegions.PLAYBACK_SEEK_BACKWARD,
      ],
      [["playbackControlsPreviousTrackShow"], PopupRegions.PLAYBACK_PREVIOUS],
      [["playbackControlsPlayPauseShow"], PopupRegions.PLAYBACK_PLAY_PAUSE],
      [["playbackControlsNextTrackShow"], PopupRegions.PLAYBACK_NEXT],
      [["playbackControlsSeekForwardShow"], PopupRegions.PLAYBACK_SEEK_FORWARD],
      [["playbackControlsRepeatShow"], PopupRegions.PLAYBACK_REPEAT],
      [["playbackControlsSpeedShow"], PopupRegions.PLAYBACK_SPEED],
    ];

    for (const [properties, regions] of subscriptions)
      this.settingsSubscriptions.push(
        this.settings.subscribe(properties, () => this.requestUpdate(regions)),
      );
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
        PopupRegions.PLAYER_SELECTOR |
        PopupRegions.ARTWORK |
        PopupRegions.TRACK_INFORMATION |
        PopupRegions.PLAYBACK_CONTROLS;
      if (this.settings.progressBarShow) regions |= PopupRegions.PROGRESS;
      if (this.settings.volumeControlShow) regions |= PopupRegions.VOLUME;

      // Opening is already a synchronous Shell transition. Cancel any queued
      // idle pass and reconcile the accumulated state once against current data.
      this.updateQueue.cancel();
      this.pendingClosedRegions = 0;
      this.reconcile(regions, true);
      this.syncProgressBarPlaybackState();
      return;
    }

    this.playerSelector.close();
    this.artwork.cancelArtworkLoad();
    this.progressBar.pause();
  }

  isActivePlayer(player) {
    return this.indicator.isActivePlayer(player);
  }

  selectPlayer(player) {
    return this.mediaRuntime?.selectPlayer(player) ?? false;
  }

  togglePlayerPin(player) {
    const pinStateChanged = this.mediaRuntime?.togglePlayerPin(player) ?? false;
    if (pinStateChanged) this.requestUpdate(PopupRegions.PLAYER_SELECTOR);
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

    if (popupRegions & PopupRegions.PLAYER_SELECTOR) {
      this.runComponentUpdate("player selector", () =>
        this.playerSelector.render(),
      );
    }

    if (popupRegions & PopupRegions.ARTWORK) {
      this.runComponentUpdate("artwork", () => {
        if (this.settings.artworkShow) return this.artwork.render();
        this.artwork.remove();
        return null;
      });
    }

    if (popupRegions & PopupRegions.TRACK_INFORMATION) {
      this.runComponentUpdate("track information", () => {
        if (this.settings.trackInformationShow)
          return this.trackInformation.render();
        this.trackInformation.remove();
        return null;
      });
    }

    if (popupRegions & PopupRegions.PROGRESS) {
      this.runComponentUpdate("progress bar", () => {
        if (this.settings.progressBarShow) return this.progressBar.render();
        this.progressBar.remove();
        return null;
      });
    }

    if (popupRegions & PopupRegions.PLAYBACK_CONTROLS) {
      this.runComponentUpdate("playback controls", () => {
        if (
          isPlaybackControlSurfaceVisible(
            this.settings,
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
        if (this.settings.volumeControlShow) return this.volumeControl.render();
        this.volumeControl.remove();
        return null;
      });
    }

    if (this.settings.volumeControlShow) this.volumeControl.reconcilePosition();
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
      this.player.playbackStatus !== PlaybackStatus.PLAYING
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

  syncArtworkPlaybackState() {
    if (!this.menu.isOpen || !this.settings.artworkShow) return;
    this.artwork.syncPlaybackState(this.player.playbackStatus);
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
    const showTransportControls = this.settings.playbackControlsShow;
    return resolvePopupWidth(
      this.settings.width,
      showTransportControls && this.settings.playbackControlsSeekBackwardShow,
      showTransportControls && this.settings.playbackControlsSeekForwardShow,
      showTransportControls && this.settings.playbackControlsPreviousTrackShow,
      showTransportControls && this.settings.playbackControlsNextTrackShow,
    );
  }

  getPopupContentWidth() {
    return this.getPopupOuterWidth() - POPUP_CONTAINER_PADDING * 2;
  }

  getArtworkWidth() {
    return this.getPopupContentWidth();
  }

  syncPopupSize() {
    if (!this.popupItem) return;

    const width = this.getPopupOuterWidth();
    if (width === this.appliedPopupOuterWidth) return;
    this.appliedPopupOuterWidth = width;
    this.popupItem.style = this.buildFixedWidthStyle(width);
    this.playerSelector.syncPlayerSelectorWidth();
  }

  destroy() {
    const indicator = this.indicator;
    if (!indicator) return;

    this.updateQueue?.destroy();
    this.updateQueue = null;
    for (const unsubscribe of this.settingsSubscriptions.splice(0).reverse())
      unsubscribe();
    this.settings = null;
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
    const artwork = this.artwork;
    const playerSelector = this.playerSelector;
    const popupItem = this.popupItem;
    this.progressBar = null;
    this.trackInformation = null;
    this.playbackControls = null;
    this.volumeControl = null;
    this.artwork = null;
    this.playerSelector = null;
    this.popupItem = null;

    progressBar?.destroy();
    trackInformation?.destroy();
    playbackControls?.destroy();
    volumeControl?.destroy();
    artwork?.destroy();
    playerSelector?.destroy();
    popupItem?.destroy();

    this.pendingClosedRegions = 0;
    this.appliedPopupOuterWidth = null;
  }
}
