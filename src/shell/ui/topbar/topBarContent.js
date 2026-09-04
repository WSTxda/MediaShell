/**
 * @file topBarContent.js
 * @module shell.ui.topbar.topBarContent
 *
 * Owns and incrementally reconciles the MediaShell top-bar surface.
 *
 * TopBarContent owns its actor tree, surface-local dirty regions, and the idle
 * source used to coalesce MPRIS/settings bursts. Popup state is intentionally
 * absent from this module.
 */

import { MediaShellStyleClasses } from "../style.js";
import Clutter from "gi://Clutter";
import St from "gi://St";

import { PlaybackControlSurfaces } from "../../../shared/playback/surfaces.js";
import { TopBarElementIds } from "../../../shared/ui/topBar.js";
import { createLogger } from "../../../shared/logging/logger.js";
import { isPlaybackControlSurfaceVisible } from "../../media/playback/surfaceState.js";
import CoalescedUpdateQueue from "../reconciliation/coalescedUpdateQueue.js";
import TopBarArtwork from "./topBarArtwork.js";
import TopBarAppIcon from "./topBarAppIcon.js";
import TopBarPlaybackControls from "./topBarPlaybackControls.js";
import TopBarTrackInformation from "./topBarTrackInformation.js";
import TopBarVisualizer from "./topBarVisualizer.js";
import { TopBarRegions } from "./regions.js";

const logger = createLogger("TopBarContent");

/** Owns and reconciles every component rendered in the top bar. */
export default class TopBarContent {
  constructor(
    indicator,
    { artworkService, desktopAppResolver, playbackController, topBarSettings },
  ) {
    this.indicator = indicator;
    this.settings = topBarSettings;
    this.settingsSubscriptions = [];
    this.topBarBox = null;
    this.topBarActionBoxBefore = null;
    this.topBarActionBoxAfter = null;
    this.updateQueue = new CoalescedUpdateQueue(
      (regions) => this.reconcile(regions),
      (error) =>
        logger.errorOnce(
          "deferred-surface-update",
          "Deferred top-bar reconciliation failed",
          error,
        ),
    );
    this.appIcon = new TopBarAppIcon(this, desktopAppResolver);
    this.artwork = new TopBarArtwork(this, artworkService);
    this.trackInformation = new TopBarTrackInformation(this);
    // The visualizer is created lazily so the disabled default owns no actor or timer.
    this.visualizer = null;
    this.playbackControls = new TopBarPlaybackControls(
      this,
      playbackController,
    );
    this.installSettingsSubscriptions();
  }

  get player() {
    return this.indicator.player;
  }

  installSettingsSubscriptions() {
    const subscriptions = [
      [
        ["trackInformationWidth", "trackInformationWidthLock"],
        TopBarRegions.LAYOUT,
      ],
      [
        [
          "trackInformationShow",
          "trackInformationContent",
          "trackInformationScrollEnabled",
          "trackInformationScrollSpeed",
          "trackInformationScrollPauseMilliseconds",
        ],
        TopBarRegions.TRACK_INFORMATION,
      ],
      [["appIconShow", "appIconUseColor"], TopBarRegions.APP_ICON],
      [["artworkShow", "artworkCornerRadius"], TopBarRegions.ARTWORK],
      [
        ["visualizerShow", "visualizerStyle", "visualizerSpeed"],
        TopBarRegions.VISUALIZER,
      ],
      [["playbackControlsShow"], TopBarRegions.PLAYBACK_CONTROLS],
      [["playbackControlsShuffleShow"], TopBarRegions.PLAYBACK_SHUFFLE],
      [
        ["playbackControlsSeekBackwardShow"],
        TopBarRegions.PLAYBACK_SEEK_BACKWARD,
      ],
      [["playbackControlsPreviousTrackShow"], TopBarRegions.PLAYBACK_PREVIOUS],
      [["playbackControlsPlayPauseShow"], TopBarRegions.PLAYBACK_PLAY_PAUSE],
      [["playbackControlsNextTrackShow"], TopBarRegions.PLAYBACK_NEXT],
      [
        ["playbackControlsSeekForwardShow"],
        TopBarRegions.PLAYBACK_SEEK_FORWARD,
      ],
      [["playbackControlsRepeatShow"], TopBarRegions.PLAYBACK_REPEAT],
      [["elementOrder"], TopBarRegions.ELEMENT_ORDER],
    ];

    for (const [properties, regions] of subscriptions)
      this.settingsSubscriptions.push(
        this.settings.subscribe(properties, () => this.requestUpdate(regions)),
      );
  }

  requestUpdate(regions) {
    this.updateQueue?.request(regions & TopBarRegions.ALL);
  }

  resetPendingUpdates() {
    this.updateQueue?.cancel();
  }

  reconcile(regions) {
    const topBarRegions = regions & TopBarRegions.ALL;
    if (!this.indicator || !topBarRegions) return;

    this.ensureLayout();

    const playbackOrderIndex = this.settings.elementOrder.indexOf(
      TopBarElementIds.PLAYBACK_CONTROLS,
    );
    let beforePlaybackIndex = 0;
    let afterPlaybackIndex = 0;

    for (
      let orderIndex = 0;
      orderIndex < this.settings.elementOrder.length;
      orderIndex++
    ) {
      const elementId = this.settings.elementOrder[orderIndex];
      const isVisible = this.isElementVisible(elementId);
      const isBeforePlayback =
        playbackOrderIndex < 0 || orderIndex < playbackOrderIndex;
      const targetBox = isBeforePlayback
        ? this.topBarActionBoxBefore
        : this.topBarActionBoxAfter;
      const targetIndex = isBeforePlayback
        ? beforePlaybackIndex
        : afterPlaybackIndex;

      if (
        elementId === TopBarElementIds.APP_ICON &&
        (topBarRegions & TopBarRegions.APP_ICON ||
          topBarRegions & TopBarRegions.ELEMENT_ORDER)
      ) {
        this.runComponentUpdate("top bar player icon", () => {
          if (isVisible) this.appIcon.render(targetIndex, targetBox);
          else this.appIcon.remove();
        });
      }

      if (
        elementId === TopBarElementIds.ARTWORK &&
        (topBarRegions & TopBarRegions.ARTWORK ||
          topBarRegions & TopBarRegions.ELEMENT_ORDER)
      ) {
        this.runComponentUpdate("top bar artwork", () => {
          if (isVisible) this.artwork.render(targetIndex, targetBox);
          else this.artwork.remove();
        });
      }

      if (
        elementId === TopBarElementIds.TRACK_INFORMATION &&
        (topBarRegions & TopBarRegions.TRACK_INFORMATION ||
          topBarRegions & TopBarRegions.ELEMENT_ORDER)
      ) {
        this.runComponentUpdate("top bar track information", () => {
          if (isVisible) this.trackInformation.render(targetIndex, targetBox);
          else this.trackInformation.remove();
        });
      }

      if (
        elementId === TopBarElementIds.VISUALIZER &&
        (topBarRegions & TopBarRegions.VISUALIZER ||
          topBarRegions & TopBarRegions.ELEMENT_ORDER)
      ) {
        this.runComponentUpdate("top bar visualizer", () =>
          this.reconcileVisualizer(targetIndex, targetBox),
        );
      }

      if (
        elementId === TopBarElementIds.PLAYBACK_CONTROLS &&
        (topBarRegions & TopBarRegions.PLAYBACK_CONTROLS ||
          topBarRegions & TopBarRegions.ELEMENT_ORDER)
      ) {
        this.runComponentUpdate("top bar playback controls", () => {
          if (isVisible) this.playbackControls.render(topBarRegions);
          else this.playbackControls.remove();
        });
      }

      if (isVisible && elementId !== TopBarElementIds.PLAYBACK_CONTROLS) {
        if (isBeforePlayback) beforePlaybackIndex++;
        else afterPlaybackIndex++;
      }
    }

    if (!this.topBarBox.get_parent()) this.indicator.add_child(this.topBarBox);

    if (
      topBarRegions & TopBarRegions.CONTENT ||
      topBarRegions & TopBarRegions.LAYOUT ||
      topBarRegions & TopBarRegions.ELEMENT_ORDER
    )
      this.syncLayout();
  }

  ensureLayout() {
    if (this.topBarBox) return;

    this.topBarBox = new St.BoxLayout({
      styleClass: MediaShellStyleClasses.TOP_BAR_BOX,
    });
    this.topBarActionBoxBefore = this.createActionBox();
    this.topBarActionBoxAfter = this.createActionBox();
    this.topBarBox.add_child(this.topBarActionBoxBefore);
    this.topBarBox.add_child(this.topBarActionBoxAfter);
  }

  syncLayout() {
    if (!this.topBarBox) return;

    for (const actionBox of [
      this.topBarActionBoxBefore,
      this.topBarActionBoxAfter,
    ]) {
      actionBox.xExpand = false;
      actionBox.xAlign = Clutter.ActorAlign.START;
    }
    if (this.trackInformation.actor) {
      this.trackInformation.actor.xExpand = false;
      this.trackInformation.actor.xAlign = Clutter.ActorAlign.START;
    }

    // Width belongs to track information, not to the complete top-bar row.
    this.trackInformation.setWidth(
      this.settings.trackInformationWidth,
      this.settings.trackInformationWidthLock,
    );
    this.topBarBox.set_style(null);
  }

  createActionBox() {
    return new St.BoxLayout({
      styleClass: MediaShellStyleClasses.TOP_BAR_ACTION_BOX,
      reactive: true,
      trackHover: false,
      xExpand: false,
      xAlign: Clutter.ActorAlign.START,
    });
  }

  isElementVisible(elementId) {
    if (elementId === TopBarElementIds.APP_ICON)
      return this.settings.appIconShow;
    if (elementId === TopBarElementIds.ARTWORK)
      return this.settings.artworkShow;
    if (elementId === TopBarElementIds.TRACK_INFORMATION)
      return this.settings.trackInformationShow;
    if (elementId === TopBarElementIds.VISUALIZER)
      return this.settings.visualizerShow;
    if (elementId === TopBarElementIds.PLAYBACK_CONTROLS)
      return isPlaybackControlSurfaceVisible(
        this.settings,
        PlaybackControlSurfaces.TOP_BAR,
      );
    return false;
  }

  reconcileVisualizer(index, targetBox) {
    if (!this.settings.visualizerShow) {
      this.visualizer?.destroy();
      this.visualizer = null;
      return;
    }

    this.visualizer ??= new TopBarVisualizer(this);
    this.visualizer.render(index, targetBox);
  }

  runComponentUpdate(componentName, update) {
    try {
      update();
    } catch (error) {
      logger.errorOnce(
        `component-update:${componentName}`,
        `${componentName} update failed`,
        error,
      );
    }
  }

  destroy() {
    if (!this.indicator) return;

    this.updateQueue?.destroy();
    this.updateQueue = null;
    for (const unsubscribe of this.settingsSubscriptions.splice(0).reverse())
      unsubscribe();
    this.settings = null;
    this.indicator = null;

    const playbackControls = this.playbackControls;
    const visualizer = this.visualizer;
    const trackInformation = this.trackInformation;
    const appIcon = this.appIcon;
    const artwork = this.artwork;
    this.playbackControls = null;
    this.visualizer = null;
    this.trackInformation = null;
    this.appIcon = null;
    this.artwork = null;

    playbackControls?.destroy();
    visualizer?.destroy();
    trackInformation?.destroy();
    appIcon?.destroy();
    artwork?.destroy();

    this.topBarBox?.get_parent()?.remove_child(this.topBarBox);
    this.topBarBox?.destroy();
    this.topBarBox = null;
    this.topBarActionBoxBefore = null;
    this.topBarActionBoxAfter = null;
  }
}
