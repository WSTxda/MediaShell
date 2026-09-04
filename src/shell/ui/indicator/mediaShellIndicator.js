/**
 * @file mediaShellIndicator.js
 * @module shell.ui.indicator.mediaShellIndicator
 *
 * Owns the MediaShell panel indicator and routes player state to its surfaces.
 *
 * PopupContent and TopBarContent own their actor trees, dirty-region masks, and
 * idle coalescing. The indicator only translates MPRIS changes into independent
 * surface updates and owns listeners tied to the currently active player.
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";

import {
  MprisPlayerProperties,
  MprisRootProperties,
} from "../../mpris/protocol.js";
import { GTypeNames } from "../../../shared/gobject.js";
import { MprisPlayerStateProperties } from "../../mpris/clientPolicy.js";
import {
  DESKTOP_APP_RESOLUTION_RETRY_DELAY_MS,
  DESKTOP_APP_RESOLUTION_RETRY_MAX_ATTEMPTS,
} from "../../media/identity/constants.js";
import { createLogger } from "../../../shared/logging/logger.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import PopupContent from "../popup/popupContent.js";
import TopBarContent from "../topbar/topBarContent.js";
import IndicatorPointerHandler from "./indicatorPointerHandler.js";
import {
  PlayerSurfaceUpdates,
  createMetadataSurfaceUpdate,
} from "./surfaceUpdates.js";

const logger = createLogger("MediaShellIndicator");

/** Owns the panel indicator and the active-player listener lifecycle. */
class MediaShellIndicator extends PanelMenu.Button {
  constructor(mediaApp, extensionController, { mediaRuntime }) {
    super(0.5, "MediaShell", false);
    this.mediaApp = mediaApp;
    this.extensionController = extensionController;
    this.mediaRuntime = mediaRuntime;
    this.mediaAppPropertyListenerIds = new Map();
    this.desktopAppResolutionRetrySourceId = null;
    this.desktopAppResolutionRetryAttemptsRemaining = 0;
    this.disconnectPositionChangeListener = null;
    const surfaceDependencies = {
      artworkService: mediaRuntime.artwork,
      desktopAppResolver: mediaRuntime.identity,
      playbackController: mediaRuntime.playback,
    };
    this.topBarContent = new TopBarContent(this, surfaceDependencies);
    this.popupContent = new PopupContent(this, surfaceDependencies);
    this.pointerHandler = new IndicatorPointerHandler(this);
    this.addMediaAppPropertyListeners();
    this.reconcileSurfacesNow(PlayerSurfaceUpdates.ALL);
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
    this.resetPendingSurfaceUpdates();
    this.cancelDesktopAppResolutionRetry();
    this.mediaApp = mediaApp;
    this.addMediaAppPropertyListeners();
    // Preserve existing actors during feed/player hand-offs. Each surface
    // reconciles the new player into its current actor tree instead of remounting.
    this.reconcileSurfacesNow(PlayerSurfaceUpdates.ALL);
    this.scheduleDesktopAppResolutionRetry();
  }

  isActiveMediaApp(mediaApp) {
    return Boolean(
      this.mediaApp && mediaApp && this.mediaApp.busName === mediaApp.busName,
    );
  }

  requestSurfaceUpdate({ popup = 0, topBar = 0 } = {}) {
    if (!this.extensionController) return;
    if (topBar) this.topBarContent?.requestUpdate(topBar);
    if (popup) this.popupContent?.requestUpdate(popup);
  }

  reconcileSurfacesNow({ popup = 0, topBar = 0 } = {}) {
    if (!this.extensionController) return;
    if (topBar) this.topBarContent?.reconcile(topBar);
    if (popup) this.popupContent?.reconcile(popup);
  }

  resetPendingSurfaceUpdates() {
    this.topBarContent?.resetPendingUpdates();
    this.popupContent?.resetPendingUpdates();
  }

  addMediaAppPropertyListeners() {
    this.addMediaAppPropertyListener(MprisPlayerProperties.METADATA, () => {
      this.requestMetadataSurfaceUpdate();
    });
    const updateMediaAppIdentity = () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.IDENTITY);
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
        this.requestSurfaceUpdate(PlayerSurfaceUpdates.PLAYBACK_STATUS);
        this.popupContent.syncAlbumArtPlaybackState();
        this.popupContent.syncProgressBarPlaybackState();
      },
    );
    this.addMediaAppPropertyListener(MprisPlayerProperties.CAN_PLAY, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.PLAY_PAUSE_CAPABILITY);
    });
    this.addMediaAppPropertyListener(MprisPlayerProperties.CAN_PAUSE, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.PLAY_PAUSE_CAPABILITY);
    });
    this.addMediaAppPropertyListener(MprisPlayerProperties.CAN_SEEK, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.SEEK_CAPABILITY);
    });
    this.addMediaAppPropertyListener(MprisPlayerProperties.CAN_GO_NEXT, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.NEXT_CAPABILITY);
    });
    this.addMediaAppPropertyListener(
      MprisPlayerProperties.CAN_GO_PREVIOUS,
      () => {
        this.requestSurfaceUpdate(PlayerSurfaceUpdates.PREVIOUS_CAPABILITY);
      },
    );
    this.addMediaAppPropertyListener(MprisPlayerProperties.CAN_CONTROL, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.CONTROL_CAPABILITY);
    });
    this.addMediaAppPropertyListener(MprisPlayerProperties.SHUFFLE, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.SHUFFLE);
    });
    this.addMediaAppPropertyListener(MprisPlayerProperties.LOOP_STATUS, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.LOOP_STATUS);
    });
    this.addMediaAppPropertyListener(MprisPlayerProperties.VOLUME, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.VOLUME);
    });
    this.addMediaAppPropertyListener(MprisPlayerStateProperties.IS_PINNED, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.PIN);
    });
    const updatePlaybackSpeedControl = () =>
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.RATE);
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

  requestMetadataSurfaceUpdate() {
    this.requestSurfaceUpdate(
      createMetadataSurfaceUpdate(
        Boolean(
          this.menu?.isOpen && this.extensionController.popupProgressBarShow,
        ),
      ),
    );
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

        // A resolved top-bar icon proves Shell has associated the endpoint with
        // a desktop app. Otherwise retry only a small, bounded number of times.
        if (this.topBarContent.mediaAppIcon.iconKey !== null) {
          this.desktopAppResolutionRetrySourceId = null;
          this.desktopAppResolutionRetryAttemptsRemaining = 0;
          return GLib.SOURCE_REMOVE;
        }

        this.requestSurfaceUpdate(PlayerSurfaceUpdates.IDENTITY);
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
    this.resetPendingSurfaceUpdates();
    this.cancelDesktopAppResolutionRetry();

    const pointerHandler = this.pointerHandler;
    const popupContent = this.popupContent;
    const topBarContent = this.topBarContent;
    this.pointerHandler = null;
    this.popupContent = null;
    this.topBarContent = null;
    this.mediaApp = null;
    this.mediaRuntime = null;
    this.extensionController = null;

    pointerHandler?.destroy();
    popupContent?.destroy();
    topBarContent?.destroy();
  }

  destroy() {
    if (!this.extensionController) return;

    // PanelMenu.Button destroys its PopupMenu children as part of actor teardown.
    // Clean MediaShell-owned menu state first while Shell objects are still valid.
    this.destroyOwnedResources();
    super.destroy();
  }
}

export default GObject.registerClass(
  { GTypeName: GTypeNames.MEDIA_SHELL_INDICATOR },
  MediaShellIndicator,
);
