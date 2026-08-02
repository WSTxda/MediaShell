/**
 * @file TopBarContent.js
 * @module shell.ui.topBar.TopBarContent
 *
 * Owns the MediaShell content rendered inside the GNOME top bar indicator.
 *
 * MediaShellIndicator owns the panel actor and popup. This component owns the
 * top bar layout, element order, visibility, renderers, and their teardown.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";

import { PlaybackControlSurfaces } from "../../../shared/constants/playbackControlSurfaces.js";
import { TopBarElements } from "../../../shared/enums/topBar.js";
import { WidgetFlags } from "../../../shared/enums/widgetFlags.js";
import { createLogger } from "../../../shared/utils/log.js";
import { isPlaybackControlSurfaceVisible } from "../../../shared/utils/playbackControlSurfaceState.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import TopBarMediaAppIcon from "./TopBarMediaAppIcon.js";
import TopBarPlaybackControls from "./TopBarPlaybackControls.js";
import TopBarTrackInformation from "./TopBarTrackInformation.js";
import TopBarVisualizer from "./TopBarVisualizer.js";

const logger = createLogger("TopBarContent");

/** Owns and reconciles every component rendered in the top bar. */
export default class TopBarContent {
  constructor(indicator) {
    this.indicator = indicator;
    this.topBarBox = null;
    this.topBarActionBoxBefore = null;
    this.topBarActionBoxAfter = null;
    this.mediaAppIcon = new TopBarMediaAppIcon(this);
    this.trackInformation = new TopBarTrackInformation(this);
    // The visualizer is created lazily so the disabled default owns no actor or timer.
    this.visualizer = null;
    this.playbackControls = new TopBarPlaybackControls(this);
    this.isDestroyed = false;
  }

  get extensionController() {
    return this.indicator.extensionController;
  }

  get mediaApp() {
    return this.indicator.mediaApp;
  }

  updateWidgets(widgetFlags) {
    if (this.isDestroyed) return;

    this.ensureLayout();

    const playbackOrderIndex =
      this.extensionController.topBarElementOrder.indexOf("PLAYBACK_CONTROLS");
    let beforePlaybackIndex = 0;
    let afterPlaybackIndex = 0;

    for (
      let orderIndex = 0;
      orderIndex < this.extensionController.topBarElementOrder.length;
      orderIndex++
    ) {
      const elementName =
        this.extensionController.topBarElementOrder[orderIndex];
      const element = TopBarElements[elementName];
      const isVisible = this.isElementVisible(element);
      const isBeforePlayback =
        playbackOrderIndex < 0 || orderIndex < playbackOrderIndex;
      const targetBox = isBeforePlayback
        ? this.topBarActionBoxBefore
        : this.topBarActionBoxAfter;
      const targetIndex = isBeforePlayback
        ? beforePlaybackIndex
        : afterPlaybackIndex;

      if (
        element === TopBarElements.MEDIA_APP_ICON &&
        (widgetFlags & WidgetFlags.TOP_BAR_MEDIA_APP_ICON ||
          widgetFlags & WidgetFlags.TOP_BAR_ELEMENT_ORDER)
      ) {
        this.runWidgetUpdate("top bar media app icon", () => {
          if (isVisible) this.mediaAppIcon.render(targetIndex, targetBox);
          else this.mediaAppIcon.remove();
        });
      }

      if (
        element === TopBarElements.TRACK_INFORMATION &&
        (widgetFlags & WidgetFlags.TOP_BAR_TRACK_INFORMATION ||
          widgetFlags & WidgetFlags.TOP_BAR_ELEMENT_ORDER)
      ) {
        this.runWidgetUpdate("top bar track information", () => {
          if (isVisible) this.trackInformation.render(targetIndex, targetBox);
          else this.trackInformation.remove();
        });
      }

      if (
        element === TopBarElements.VISUALIZER &&
        (widgetFlags & WidgetFlags.TOP_BAR_VISUALIZER ||
          widgetFlags & WidgetFlags.TOP_BAR_ELEMENT_ORDER)
      ) {
        this.runWidgetUpdate("top bar visualizer", () =>
          this.updateVisualizer(targetIndex, targetBox),
        );
      }

      if (
        element === TopBarElements.PLAYBACK_CONTROLS &&
        (widgetFlags & WidgetFlags.TOP_BAR_PLAYBACK_CONTROLS ||
          widgetFlags & WidgetFlags.TOP_BAR_ELEMENT_ORDER)
      ) {
        this.runWidgetUpdate("top bar playback controls", () => {
          if (isVisible) this.playbackControls.render(widgetFlags);
          else this.playbackControls.remove();
        });
      }

      if (isVisible && element !== TopBarElements.PLAYBACK_CONTROLS) {
        if (isBeforePlayback) beforePlaybackIndex++;
        else afterPlaybackIndex++;
      }
    }

    if (!this.topBarBox.get_parent()) this.indicator.add_child(this.topBarBox);

    if (
      widgetFlags & WidgetFlags.TOP_BAR ||
      widgetFlags & WidgetFlags.TOP_BAR_ELEMENT_ORDER
    )
      this.syncLayout();
  }

  ensureLayout() {
    if (this.topBarBox) return;

    this.topBarBox = new St.BoxLayout({
      styleClass: StyleClasses.TOP_BAR_BOX,
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
      this.extensionController.topBarTrackInformationWidth,
      this.extensionController.topBarTrackInformationWidthLock,
    );
    this.topBarBox.set_style(null);
  }

  createActionBox() {
    return new St.BoxLayout({
      styleClass: StyleClasses.TOP_BAR_ACTION_BOX,
      reactive: true,
      trackHover: false,
      xExpand: false,
      xAlign: Clutter.ActorAlign.START,
    });
  }

  isElementVisible(element) {
    if (element === TopBarElements.MEDIA_APP_ICON)
      return this.extensionController.topBarMediaAppIconShow;
    if (element === TopBarElements.TRACK_INFORMATION)
      return this.extensionController.topBarTrackInformationShow;
    if (element === TopBarElements.VISUALIZER)
      return this.extensionController.topBarVisualizerShow;
    if (element === TopBarElements.PLAYBACK_CONTROLS)
      return isPlaybackControlSurfaceVisible(
        this.extensionController,
        PlaybackControlSurfaces.TOP_BAR,
      );
    return false;
  }

  updateVisualizer(index, targetBox) {
    if (!this.extensionController.topBarVisualizerShow) {
      this.visualizer?.destroy();
      this.visualizer = null;
      return;
    }

    this.visualizer ??= new TopBarVisualizer(this);
    this.visualizer.render(index, targetBox);
  }

  runWidgetUpdate(componentName, update) {
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
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    for (const property of [
      "playbackControls",
      "visualizer",
      "trackInformation",
      "mediaAppIcon",
    ]) {
      const component = this[property];
      this[property] = null;
      try {
        component?.destroy();
      } catch (error) {
        logger.error(`Failed to destroy ${property}`, error);
      }
    }

    this.topBarBox?.get_parent()?.remove_child(this.topBarBox);
    this.topBarBox?.destroy();
    this.topBarBox = null;
    this.topBarActionBoxBefore = null;
    this.topBarActionBoxAfter = null;
    this.indicator = null;
  }
}
