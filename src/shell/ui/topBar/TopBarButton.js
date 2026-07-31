/**
 * @file TopBarButton.js
 * @module shell.ui.topBar.TopBarButton
 *
 * Owns the MediaShell top bar button, popup, and top bar widget orchestration.
 *
 * ExtensionController mounts this actor into Main.panel and supplies active
 * media-app state from MediaAppRegistry. The class coalesces WidgetFlags into
 * idle updates and delegates pointer gestures to TopBarPointerHandler.
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";

import {
  MprisPlayerProperties,
  MprisRootProperties,
} from "../../../shared/constants/dbus.js";
import { GTypeNames } from "../../../shared/constants/gtypes.js";
import { MediaAppStateProperties } from "../../../shared/constants/mediaApp.js";
import {
  APP_RESOLUTION_RETRY_DELAY_MS,
  APP_RESOLUTION_RETRY_MAX_ATTEMPTS,
} from "../../../shared/constants/timing.js";
import { PlaybackControlSurfaces } from "../../../shared/constants/playbackControlSurfaces.js";
import { TopBarElements } from "../../../shared/enums/topBar.js";
import { WidgetFlags } from "../../../shared/enums/widget.js";
import { createLogger } from "../../../shared/utils/log.js";
import { isPlaybackControlSurfaceVisible } from "../../../shared/utils/playbackControlSurfaceState.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import PopupContent from "../popup/PopupContent.js";
import TopBarPlaybackControls from "./TopBarPlaybackControls.js";
import TopBarPointerHandler from "./TopBarPointerHandler.js";
import TopBarAppIcon from "./TopBarAppIcon.js";
import TopBarTrackInformation from "./TopBarTrackInformation.js";
import TopBarVisualizer from "./TopBarVisualizer.js";

const logger = createLogger("TopBarButton");

/**
 * Owns the MediaShell top bar button, popup menu, and top bar widget orchestration.
 */
class TopBarButton extends PanelMenu.Button {
  constructor(mediaApp, extensionController) {
    super(0.5, "MediaShell", false);
    this.mediaApp = mediaApp;
    this.extensionController = extensionController;
    this.mediaAppPropertyListenerIds = new Map();
    this.appResolutionRetrySourceId = null;
    this.appResolutionRetryAttemptsRemaining = 0;
    this.widgetUpdateSourceId = null;
    this.pendingWidgetFlags = 0;
    this.disconnectPositionChangeListener = null;
    this.isDestroyed = false;
    this.topBarBox = null;
    this.topBarActionBoxBefore = null;
    this.topBarActionBoxAfter = null;
    this.topBarAppIcon = new TopBarAppIcon(this);
    this.topBarTrackInformation = new TopBarTrackInformation(this);
    // The visualizer is created lazily so the disabled default owns no actor or timer.
    this.topBarVisualizer = null;
    this.topBarPlaybackControls = new TopBarPlaybackControls(this);
    this.popupContent = new PopupContent(this);
    this.pointerHandler = new TopBarPointerHandler(this);
    this.addMediaAppPropertyListeners();
    this.updateWidgets(WidgetFlags.ALL);
    this.scheduleAppResolutionRetry();
    this.pointerHandler.install();
    this.menu.box.add_style_class_name(StyleClasses.POPUP_CONTAINER);
  }

  vfunc_event() {
    return Clutter.EVENT_PROPAGATE;
  }

  setMediaApp(mediaApp) {
    if (!mediaApp || this.isActiveMediaApp(mediaApp)) return;
    this.removeMediaAppPropertyListeners();
    this.cancelPendingWidgetUpdate();
    this.cancelAppResolutionRetry();
    this.mediaApp = mediaApp;
    this.addMediaAppPropertyListeners();
    // The configured element order has not changed. Reconcile the new
    // app in place so feed hand-offs do not unparent and reinsert every
    // top bar actor.
    this.updateWidgets(WidgetFlags.ALL);
    this.scheduleAppResolutionRetry();
  }

  isActiveMediaApp(mediaApp) {
    return Boolean(
      this.mediaApp && mediaApp && this.mediaApp.busName === mediaApp.busName,
    );
  }

  // Update coalescing:
  // MPRIS endpoints emit related properties in bursts (e.g. Metadata +
  // PlaybackStatus on track change). Accumulate WidgetFlags and schedule one
  // GLib.idle_add callback so the UI renders once after the main-loop turn.
  requestWidgetUpdate(widgetFlags) {
    if (this.isDestroyed || !widgetFlags) return;
    this.pendingWidgetFlags |= widgetFlags;
    if (this.widgetUpdateSourceId !== null) return;

    this.widgetUpdateSourceId = GLib.idle_add(
      GLib.PRIORITY_DEFAULT_IDLE,
      () => {
        this.widgetUpdateSourceId = null;
        const pendingWidgetFlags = this.pendingWidgetFlags;
        this.pendingWidgetFlags = 0;
        if (!this.isDestroyed && pendingWidgetFlags) {
          try {
            this.updateWidgets(pendingWidgetFlags);
          } catch (error) {
            logger.errorOnce(
              "deferred-widget-update",
              "Deferred widget update failed",
              error,
            );
          }
        }
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  cancelPendingWidgetUpdate() {
    if (this.widgetUpdateSourceId !== null) {
      GLib.Source.remove(this.widgetUpdateSourceId);
      this.widgetUpdateSourceId = null;
    }
    this.pendingWidgetFlags = 0;
  }

  updateWidgets(widgetFlags) {
    if (this.isDestroyed) return;

    this.ensureTopBarLayout();

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
      const isVisible = this.isTopBarElementVisible(element);
      const isBeforePlayback =
        playbackOrderIndex < 0 || orderIndex < playbackOrderIndex;
      const targetBox = isBeforePlayback
        ? this.topBarActionBoxBefore
        : this.topBarActionBoxAfter;
      const targetIndex = isBeforePlayback
        ? beforePlaybackIndex
        : afterPlaybackIndex;
      if (
        element === TopBarElements.APP_ICON &&
        (widgetFlags & WidgetFlags.TOP_BAR_APP_ICON ||
          widgetFlags & WidgetFlags.TOP_BAR_ELEMENT_ORDER)
      ) {
        this.runWidgetUpdate("top bar app icon", () => {
          if (isVisible) this.topBarAppIcon.render(targetIndex, targetBox);
          else this.topBarAppIcon.remove();
        });
      }
      if (
        element === TopBarElements.TRACK_INFORMATION &&
        (widgetFlags & WidgetFlags.TOP_BAR_TRACK_INFORMATION ||
          widgetFlags & WidgetFlags.TOP_BAR_ELEMENT_ORDER)
      ) {
        this.runWidgetUpdate("top bar track information", () => {
          if (isVisible)
            this.topBarTrackInformation.render(targetIndex, targetBox);
          else this.topBarTrackInformation.remove();
        });
      }
      if (
        element === TopBarElements.VISUALIZER &&
        (widgetFlags & WidgetFlags.TOP_BAR_VISUALIZER ||
          widgetFlags & WidgetFlags.TOP_BAR_ELEMENT_ORDER)
      ) {
        this.runWidgetUpdate("top bar visualizer", () =>
          this.updateTopBarVisualizer(targetIndex, targetBox),
        );
      }
      if (
        element === TopBarElements.PLAYBACK_CONTROLS &&
        (widgetFlags & WidgetFlags.TOP_BAR_PLAYBACK_CONTROLS ||
          widgetFlags & WidgetFlags.TOP_BAR_ELEMENT_ORDER)
      ) {
        this.runWidgetUpdate("top bar playback controls", () => {
          if (isVisible) this.topBarPlaybackControls.render(widgetFlags);
          else this.topBarPlaybackControls.remove();
        });
      }
      if (isVisible && element !== TopBarElements.PLAYBACK_CONTROLS) {
        if (isBeforePlayback) beforePlaybackIndex++;
        else afterPlaybackIndex++;
      }
    }

    this.runWidgetUpdate("popup", () =>
      this.popupContent.updateWidgets(widgetFlags),
    );
    if (!this.topBarBox.get_parent()) this.add_child(this.topBarBox);

    if (
      widgetFlags & WidgetFlags.TOP_BAR ||
      widgetFlags & WidgetFlags.TOP_BAR_ELEMENT_ORDER
    )
      this.syncTopBarLayout();
  }

  ensureTopBarLayout() {
    if (this.topBarBox) return;

    this.topBarBox = new St.BoxLayout({
      styleClass: StyleClasses.TOP_BAR_BOX,
    });
    this.topBarActionBoxBefore = this.createTopBarActionBox();
    this.topBarActionBoxAfter = this.createTopBarActionBox();
    this.topBarBox.add_child(this.topBarActionBoxBefore);
    this.topBarBox.add_child(this.topBarActionBoxAfter);
  }

  syncTopBarLayout() {
    if (!this.topBarBox) return;

    for (const actionBox of [
      this.topBarActionBoxBefore,
      this.topBarActionBoxAfter,
    ]) {
      actionBox.xExpand = false;
      actionBox.xAlign = Clutter.ActorAlign.START;
    }
    if (this.topBarTrackInformation.actor) {
      this.topBarTrackInformation.actor.xExpand = false;
      this.topBarTrackInformation.actor.xAlign = Clutter.ActorAlign.START;
    }

    // Preserve the original setting contract: Width belongs to track
    // information, not to the complete top-bar row. Fixed-width actors keep
    // their natural width and are laid out next to the metadata regardless of
    // element order. A zero value leaves the metadata unconstrained, while
    // Lock width fixes only the metadata region when Width is greater than 0.
    this.topBarTrackInformation.setWidth(
      this.extensionController.topBarTrackInformationWidth,
      this.extensionController.topBarTrackInformationWidthLock,
    );
    this.topBarBox.set_style(null);
  }

  createTopBarActionBox() {
    return new St.BoxLayout({
      styleClass: StyleClasses.TOP_BAR_ACTION_BOX,
      reactive: true,
      trackHover: false,
      xExpand: false,
      xAlign: Clutter.ActorAlign.START,
    });
  }

  isTopBarElementVisible(element) {
    if (element === TopBarElements.APP_ICON)
      return this.extensionController.topBarAppIconShow;
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

  updateTopBarVisualizer(index, targetBox) {
    if (!this.extensionController.topBarVisualizerShow) {
      this.topBarVisualizer?.destroy();
      this.topBarVisualizer = null;
      return;
    }

    this.topBarVisualizer ??= new TopBarVisualizer(this);
    this.topBarVisualizer.render(index, targetBox);
  }

  runWidgetUpdate(componentName, update) {
    try {
      update();
    } catch (error) {
      // Keep later components and MPRIS listeners alive even when a
      // single actor fails to render.
      logger.errorOnce(
        `component-update:${componentName}`,
        `${componentName} update failed`,
        error,
      );
    }
  }

  addMediaAppPropertyListeners() {
    this.addMediaAppPropertyListener(MprisPlayerProperties.METADATA, () => {
      this.queueMetadataWidgetUpdate();
    });
    const updateAppIdentity = () => {
      this.requestWidgetUpdate(
        WidgetFlags.TOP_BAR_APP_ICON | WidgetFlags.POPUP_APP_SELECTOR,
      );
      this.scheduleAppResolutionRetry();
    };
    this.addMediaAppPropertyListener(
      MprisRootProperties.IDENTITY,
      updateAppIdentity,
    );
    this.addMediaAppPropertyListener(
      MprisRootProperties.DESKTOP_ENTRY,
      updateAppIdentity,
    );
    this.addMediaAppPropertyListener(
      MprisPlayerProperties.PLAYBACK_STATUS,
      () => {
        this.requestWidgetUpdate(
          WidgetFlags.TOP_BAR_PLAYBACK_PLAY_PAUSE |
            WidgetFlags.TOP_BAR_VISUALIZER |
            WidgetFlags.POPUP_PLAYBACK_PLAY_PAUSE |
            WidgetFlags.POPUP_PROGRESS_BAR,
        );
        this.popupContent.syncAlbumArtPlaybackState();
        this.popupContent.syncProgressBarPlaybackState();
      },
    );
    this.addMediaAppPropertyListener(MprisPlayerProperties.CAN_PLAY, () => {
      this.requestWidgetUpdate(
        WidgetFlags.TOP_BAR_PLAYBACK_PLAY_PAUSE |
          WidgetFlags.POPUP_PLAYBACK_PLAY_PAUSE,
      );
    });
    this.addMediaAppPropertyListener(MprisPlayerProperties.CAN_PAUSE, () => {
      this.requestWidgetUpdate(
        WidgetFlags.TOP_BAR_PLAYBACK_PLAY_PAUSE |
          WidgetFlags.POPUP_PLAYBACK_PLAY_PAUSE,
      );
    });
    this.addMediaAppPropertyListener(MprisPlayerProperties.CAN_SEEK, () => {
      this.requestWidgetUpdate(
        WidgetFlags.POPUP_PROGRESS_BAR |
          WidgetFlags.TOP_BAR_PLAYBACK_SEEK_BACKWARD |
          WidgetFlags.TOP_BAR_PLAYBACK_SEEK_FORWARD |
          WidgetFlags.POPUP_PLAYBACK_SEEK_BACKWARD |
          WidgetFlags.POPUP_PLAYBACK_SEEK_FORWARD,
      );
    });
    this.addMediaAppPropertyListener(MprisPlayerProperties.CAN_GO_NEXT, () => {
      this.requestWidgetUpdate(
        WidgetFlags.TOP_BAR_PLAYBACK_NEXT | WidgetFlags.POPUP_PLAYBACK_NEXT,
      );
    });
    this.addMediaAppPropertyListener(
      MprisPlayerProperties.CAN_GO_PREVIOUS,
      () => {
        this.requestWidgetUpdate(
          WidgetFlags.TOP_BAR_PLAYBACK_PREVIOUS |
            WidgetFlags.POPUP_PLAYBACK_PREVIOUS,
        );
      },
    );
    this.addMediaAppPropertyListener(MprisPlayerProperties.CAN_CONTROL, () => {
      this.requestWidgetUpdate(
        WidgetFlags.TOP_BAR_PLAYBACK_CONTROLS |
          WidgetFlags.POPUP_PLAYBACK_CONTROLS,
      );
    });
    this.addMediaAppPropertyListener(MprisPlayerProperties.SHUFFLE, () => {
      this.requestWidgetUpdate(
        WidgetFlags.TOP_BAR_PLAYBACK_SHUFFLE |
          WidgetFlags.POPUP_PLAYBACK_SHUFFLE,
      );
    });
    this.addMediaAppPropertyListener(MprisPlayerProperties.LOOP_STATUS, () => {
      this.requestWidgetUpdate(
        WidgetFlags.TOP_BAR_PLAYBACK_REPEAT | WidgetFlags.POPUP_PLAYBACK_REPEAT,
      );
    });
    this.addMediaAppPropertyListener(MediaAppStateProperties.IS_PINNED, () => {
      this.requestWidgetUpdate(WidgetFlags.POPUP_APP_SELECTOR);
    });
    const updatePlaybackSpeedControl = () =>
      this.requestWidgetUpdate(WidgetFlags.POPUP_PLAYBACK_SPEED);
    this.addMediaAppPropertyListener(MprisPlayerProperties.RATE, () => {
      this.popupContent.setPlaybackRate(this.mediaApp.rate);
      updatePlaybackSpeedControl();
    });
    this.addMediaAppPropertyListener(
      MprisPlayerProperties.MINIMUM_RATE,
      updatePlaybackSpeedControl,
    );
    this.addMediaAppPropertyListener(
      MprisPlayerProperties.MAXIMUM_RATE,
      updatePlaybackSpeedControl,
    );
    const observedMediaApp = this.mediaApp;
    this.disconnectPositionChangeListener = observedMediaApp.onPositionChanged(
      (positionMicroseconds) => {
        if (this.mediaApp !== observedMediaApp) return;
        this.popupContent.setPlaybackPosition(positionMicroseconds);
      },
    );
  }

  queueMetadataWidgetUpdate() {
    let widgetFlags = WidgetFlags.TOP_BAR_TRACK_INFORMATION;
    if (this.menu?.isOpen) {
      widgetFlags |=
        WidgetFlags.POPUP_ALBUM_ART | WidgetFlags.POPUP_TRACK_INFORMATION;
      if (this.extensionController.popupProgressBarShow)
        widgetFlags |= WidgetFlags.POPUP_PROGRESS_BAR;
    }
    // requestWidgetUpdate() already coalesces the MPRIS burst at the next idle
    // turn. A second 100 ms timer only delayed visible metadata and retained
    // this button longer without reducing same-turn work.
    this.requestWidgetUpdate(widgetFlags);
  }

  scheduleAppResolutionRetry() {
    this.cancelAppResolutionRetry();
    this.appResolutionRetryAttemptsRemaining =
      APP_RESOLUTION_RETRY_MAX_ATTEMPTS;

    const observedMediaApp = this.mediaApp;
    this.appResolutionRetrySourceId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      APP_RESOLUTION_RETRY_DELAY_MS,
      () => {
        if (this.isDestroyed || this.mediaApp !== observedMediaApp) {
          this.appResolutionRetrySourceId = null;
          this.appResolutionRetryAttemptsRemaining = 0;
          return GLib.SOURCE_REMOVE;
        }

        // A resolved top bar icon proves that Shell has associated the
        // MPRIS endpoint with a desktop app. Stop polling early;
        // otherwise retry only a small, bounded number of times.
        if (this.topBarAppIcon.iconKey !== null) {
          this.appResolutionRetrySourceId = null;
          this.appResolutionRetryAttemptsRemaining = 0;
          return GLib.SOURCE_REMOVE;
        }

        this.requestWidgetUpdate(
          WidgetFlags.TOP_BAR_APP_ICON | WidgetFlags.POPUP_APP_SELECTOR,
        );
        this.appResolutionRetryAttemptsRemaining--;
        if (this.appResolutionRetryAttemptsRemaining <= 0) {
          this.appResolutionRetrySourceId = null;
          return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  cancelAppResolutionRetry() {
    if (this.appResolutionRetrySourceId !== null) {
      GLib.Source.remove(this.appResolutionRetrySourceId);
      this.appResolutionRetrySourceId = null;
    }
    this.appResolutionRetryAttemptsRemaining = 0;
  }

  removeMediaAppPropertyListeners() {
    this.disconnectPositionChangeListener?.();
    this.disconnectPositionChangeListener = null;

    if (this.mediaApp) {
      for (const [
        property,
        listenerId,
      ] of this.mediaAppPropertyListenerIds.entries()) {
        this.mediaApp.removePropertyChangeListener(property, listenerId);
      }
    }
    this.mediaAppPropertyListenerIds.clear();
  }

  addMediaAppPropertyListener(property, callback) {
    const observedMediaApp = this.mediaApp;
    const safeCallback = () => {
      if (this.mediaApp !== observedMediaApp) return;
      try {
        callback();
      } catch (error) {
        logger.errorOnce(
          `mpris-listener:${property}`,
          `MPRIS listener failed for ${property}`,
          error,
        );
      }
    };
    const listenerId = observedMediaApp.onPropertyChanged(
      property,
      safeCallback,
    );
    this.mediaAppPropertyListenerIds.set(property, listenerId);
  }

  destroyOwnedResources() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.removeMediaAppPropertyListeners();
    this.cancelPendingWidgetUpdate();
    this.cancelAppResolutionRetry();
    for (const [name, component] of [
      ["pointerHandler", this.pointerHandler],
      ["popupContent", this.popupContent],
      ["topBarPlaybackControls", this.topBarPlaybackControls],
      ["topBarVisualizer", this.topBarVisualizer],
      ["topBarTrackInformation", this.topBarTrackInformation],
      ["topBarAppIcon", this.topBarAppIcon],
    ]) {
      try {
        component?.destroy();
      } catch (error) {
        logger.error(`Failed to destroy ${name}`, error);
      }
      this[name] = null;
    }
    this.mediaApp = null;
    this.extensionController = null;
    this.topBarBox = null;
    this.topBarActionBoxBefore = null;
    this.topBarActionBoxAfter = null;
  }

  destroy() {
    if (this.isDestroyed) return;

    // PanelMenu.Button destroys its PopupMenu children as part of the actor
    // teardown. Clean MediaShell-owned menu items and signals first, while
    // the Shell objects are still valid, so teardown does not attempt to
    // disconnect a disposed PopupBaseMenuItem.
    this.destroyOwnedResources();
    super.destroy();
  }
}

export default GObject.registerClass(
  { GTypeName: GTypeNames.TOP_BAR_BUTTON },
  TopBarButton,
);
