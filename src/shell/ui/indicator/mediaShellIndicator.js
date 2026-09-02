/**
 * @file mediaShellIndicator.js
 * @module shell.ui.indicator.mediaShellIndicator
 *
 * Owns the MediaShell panel indicator, popup, and surface orchestration.
 *
 * ExtensionController mounts this actor into Main.panel and supplies active
 * media-app state from MediaAppRegistry. The class coalesces WidgetFlags into
 * idle updates and delegates pointer gestures to IndicatorPointerHandler.
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";

import {
  MprisPlayerProperties,
  MprisRootProperties,
} from "../../../shared/constants/mpris.js";
import { GTypeNames } from "../../../shared/constants/gtypes.js";
import { MediaAppStateProperties } from "../../constants/mediaApp.js";
import {
  DESKTOP_APP_RESOLUTION_RETRY_DELAY_MS,
  DESKTOP_APP_RESOLUTION_RETRY_MAX_ATTEMPTS,
} from "../../constants/desktopApp.js";
import { WidgetFlags } from "../../../shared/enums/widgetFlags.js";
import { createLogger } from "../../../shared/utils/log.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import PopupContent from "../popup/popupContent.js";
import TopBarContent from "../topbar/topBarContent.js";
import IndicatorPointerHandler from "./indicatorPointerHandler.js";

const logger = createLogger("MediaShellIndicator");

/**
 * Owns the MediaShell panel indicator and coordinates its top bar and popup
 * surfaces.
 */
class MediaShellIndicator extends PanelMenu.Button {
  constructor(
    mediaApp,
    extensionController,
    { albumArtLoader, desktopAppResolver },
  ) {
    super(0.5, "MediaShell", false);
    this.mediaApp = mediaApp;
    this.extensionController = extensionController;
    this.mediaAppPropertyListenerIds = new Map();
    this.desktopAppResolutionRetrySourceId = null;
    this.desktopAppResolutionRetryAttemptsRemaining = 0;
    this.widgetUpdateSourceId = null;
    this.pendingWidgetFlags = 0;
    this.disconnectPositionChangeListener = null;
    const surfaceDependencies = { albumArtLoader, desktopAppResolver };
    this.topBarContent = new TopBarContent(this, surfaceDependencies);
    this.popupContent = new PopupContent(this, surfaceDependencies);
    this.pointerHandler = new IndicatorPointerHandler(this);
    this.addMediaAppPropertyListeners();
    this.updateWidgets(WidgetFlags.ALL);
    this.scheduleDesktopAppResolutionRetry();
    this.pointerHandler.install();
    this.menu.box.add_style_class_name(StyleClasses.POPUP_CONTAINER);
  }

  vfunc_event() {
    return Clutter.EVENT_PROPAGATE;
  }

  setMediaApp(mediaApp) {
    if (
      !this.extensionController ||
      !mediaApp ||
      this.isActiveMediaApp(mediaApp)
    )
      return;
    this.removeMediaAppPropertyListeners();
    this.cancelPendingWidgetUpdate();
    this.cancelDesktopAppResolutionRetry();
    this.mediaApp = mediaApp;
    this.addMediaAppPropertyListeners();
    // The configured element order has not changed. Reconcile the new
    // app in place so feed hand-offs do not unparent and reinsert every
    // top bar actor.
    this.updateWidgets(WidgetFlags.ALL);
    this.scheduleDesktopAppResolutionRetry();
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
    if (!this.extensionController || !widgetFlags) return;
    this.pendingWidgetFlags |= widgetFlags;
    if (this.widgetUpdateSourceId !== null) return;

    this.widgetUpdateSourceId = GLib.idle_add(
      GLib.PRIORITY_DEFAULT_IDLE,
      () => {
        this.widgetUpdateSourceId = null;
        const pendingWidgetFlags = this.pendingWidgetFlags;
        this.pendingWidgetFlags = 0;
        if (this.extensionController && pendingWidgetFlags) {
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
    if (!this.extensionController) return;

    this.runWidgetUpdate("top bar", () =>
      this.topBarContent.updateWidgets(widgetFlags),
    );
    this.runWidgetUpdate("popup", () =>
      this.popupContent.updateWidgets(widgetFlags),
    );
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
      this.requestMetadataWidgetUpdate();
    });
    const updateMediaAppIdentity = () => {
      this.requestWidgetUpdate(
        WidgetFlags.TOP_BAR_MEDIA_APP_ICON |
          WidgetFlags.POPUP_MEDIA_APP_SELECTOR,
      );
      this.scheduleDesktopAppResolutionRetry();
    };
    this.addMediaAppPropertyListener(
      MprisRootProperties.IDENTITY,
      updateMediaAppIdentity,
    );
    this.addMediaAppPropertyListener(
      MprisRootProperties.DESKTOP_ENTRY,
      updateMediaAppIdentity,
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
          WidgetFlags.POPUP_PLAYBACK_CONTROLS |
          WidgetFlags.POPUP_PROGRESS_BAR |
          WidgetFlags.POPUP_VOLUME_CONTROL,
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
    this.addMediaAppPropertyListener(MprisPlayerProperties.VOLUME, () => {
      this.requestWidgetUpdate(WidgetFlags.POPUP_VOLUME_CONTROL);
    });
    this.addMediaAppPropertyListener(MediaAppStateProperties.IS_PINNED, () => {
      this.requestWidgetUpdate(WidgetFlags.POPUP_MEDIA_APP_SELECTOR);
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

  requestMetadataWidgetUpdate() {
    let widgetFlags =
      WidgetFlags.TOP_BAR_ALBUM_ART | WidgetFlags.TOP_BAR_TRACK_INFORMATION;
    if (this.menu?.isOpen) {
      widgetFlags |=
        WidgetFlags.POPUP_ALBUM_ART | WidgetFlags.POPUP_TRACK_INFORMATION;
      if (this.extensionController.popupProgressBarShow)
        widgetFlags |= WidgetFlags.POPUP_PROGRESS_BAR;
    }
    // requestWidgetUpdate() already coalesces the MPRIS burst at the next idle
    // turn. A second 100 ms timer only delayed visible metadata and retained
    // this indicator longer without reducing same-turn work.
    this.requestWidgetUpdate(widgetFlags);
  }

  scheduleDesktopAppResolutionRetry() {
    this.cancelDesktopAppResolutionRetry();
    this.desktopAppResolutionRetryAttemptsRemaining =
      DESKTOP_APP_RESOLUTION_RETRY_MAX_ATTEMPTS;

    const observedMediaApp = this.mediaApp;
    this.desktopAppResolutionRetrySourceId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      DESKTOP_APP_RESOLUTION_RETRY_DELAY_MS,
      () => {
        if (!this.extensionController || this.mediaApp !== observedMediaApp) {
          this.desktopAppResolutionRetrySourceId = null;
          this.desktopAppResolutionRetryAttemptsRemaining = 0;
          return GLib.SOURCE_REMOVE;
        }

        // A resolved top bar icon proves that Shell has associated the
        // MPRIS endpoint with a desktop app. Stop polling early;
        // otherwise retry only a small, bounded number of times.
        if (this.topBarContent.mediaAppIcon.iconKey !== null) {
          this.desktopAppResolutionRetrySourceId = null;
          this.desktopAppResolutionRetryAttemptsRemaining = 0;
          return GLib.SOURCE_REMOVE;
        }

        this.requestWidgetUpdate(
          WidgetFlags.TOP_BAR_MEDIA_APP_ICON |
            WidgetFlags.POPUP_MEDIA_APP_SELECTOR,
        );
        this.desktopAppResolutionRetryAttemptsRemaining--;
        if (this.desktopAppResolutionRetryAttemptsRemaining <= 0) {
          this.desktopAppResolutionRetrySourceId = null;
          return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  cancelDesktopAppResolutionRetry() {
    if (this.desktopAppResolutionRetrySourceId !== null) {
      GLib.Source.remove(this.desktopAppResolutionRetrySourceId);
      this.desktopAppResolutionRetrySourceId = null;
    }
    this.desktopAppResolutionRetryAttemptsRemaining = 0;
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
    if (!this.extensionController) return;

    this.removeMediaAppPropertyListeners();
    this.cancelPendingWidgetUpdate();
    this.cancelDesktopAppResolutionRetry();

    const pointerHandler = this.pointerHandler;
    const popupContent = this.popupContent;
    const topBarContent = this.topBarContent;
    this.pointerHandler = null;
    this.popupContent = null;
    this.topBarContent = null;
    this.mediaApp = null;
    this.extensionController = null;

    pointerHandler?.destroy();
    popupContent?.destroy();
    topBarContent?.destroy();
  }

  destroy() {
    if (!this.extensionController) return;

    // PanelMenu.Button destroys its PopupMenu children as part of the actor
    // teardown. Clean MediaShell-owned menu items and signals first, while
    // the Shell objects are still valid, so teardown does not attempt to
    // disconnect a disposed PopupBaseMenuItem.
    this.destroyOwnedResources();
    super.destroy();
  }
}

export default GObject.registerClass(
  { GTypeName: GTypeNames.MEDIA_SHELL_INDICATOR },
  MediaShellIndicator,
);
