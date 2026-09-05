/**
 * @file mediaShellIndicator.js
 * @module shell.ui.indicator.mediaShellIndicator
 *
 * Owns the MediaShell panel indicator and routes player state to its surfaces.
 *
 * PopupSurface and TopBarSurface own their actor trees, dirty-region masks, and
 * idle coalescing. The indicator only translates MPRIS changes into independent
 * surface updates and owns listeners tied to the currently active player.
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import GObject from "gi://GObject";

import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";

import { MediaShellStyleClasses } from "../style.js";
import {
  MprisPlayerProperties,
  MprisRootProperties,
} from "../../mpris/protocol.js";
import { MprisPlayerStateProperties } from "../../mpris/clientPolicy.js";
import {
  DESKTOP_APP_RESOLUTION_RETRY_DELAY_MS,
  DESKTOP_APP_RESOLUTION_RETRY_MAX_ATTEMPTS,
} from "../../media/identity/constants.js";
import { createLogger } from "../../../shared/logging/logger.js";
import PopupSurface from "../popup/popupSurface.js";
import TopBarSurface from "../topbar/topBarSurface.js";
import IndicatorPointerHandler from "./indicatorPointerHandler.js";
import {
  PlayerSurfaceUpdates,
  createMetadataSurfaceUpdate,
} from "./surfaceUpdates.js";

const logger = createLogger("MediaShellIndicator");

/** Owns the panel indicator and the active-player listener lifecycle. */
class MediaShellIndicator extends PanelMenu.Button {
  constructor(player, { mediaRuntime, settings, inputActions }) {
    super(0.5, "MediaShell", false);
    this.add_style_class_name(MediaShellStyleClasses.INDICATOR);
    this.player = player;
    this.inputActions = inputActions;
    this.mediaRuntime = mediaRuntime;
    this.settings = settings;
    this.playerPropertyListenerIds = new Map();
    this.desktopAppResolutionRetrySourceId = null;
    this.desktopAppResolutionRetryAttemptsRemaining = 0;
    this.disconnectPositionChangeListener = null;
    const surfaceDependencies = {
      artworkService: mediaRuntime.artwork,
      desktopAppResolver: mediaRuntime.identity,
      playbackController: mediaRuntime.playback,
      popupSettings: settings.popup,
      topBarSettings: settings.topBar,
    };
    this.topBarSurface = new TopBarSurface(this, surfaceDependencies);
    this.popupSurface = new PopupSurface(this, surfaceDependencies);
    this.pointerHandler = new IndicatorPointerHandler(this, inputActions);
    this.connectPlayerPropertyListeners();
    this.reconcileSurfacesNow(PlayerSurfaceUpdates.ALL);
    this.scheduleDesktopAppResolutionRetry();
    this.pointerHandler.install();
    this.menu.box.add_style_class_name(MediaShellStyleClasses.POPUP_CONTAINER);
  }

  vfunc_event() {
    return Clutter.EVENT_PROPAGATE;
  }

  setPlayer(player) {
    if (!player || this.isActivePlayer(player)) return;

    this.disconnectPlayerPropertyListeners();
    this.resetPendingSurfaceUpdates();
    this.cancelDesktopAppResolutionRetry();
    this.player = player;
    this.connectPlayerPropertyListeners();
    // Preserve existing actors during feed/player hand-offs. Each surface
    // reconciles the new player into its current actor tree instead of remounting.
    this.reconcileSurfacesNow(PlayerSurfaceUpdates.ALL);
    this.scheduleDesktopAppResolutionRetry();
  }

  isActivePlayer(player) {
    return Boolean(
      this.player && player && this.player.busName === player.busName,
    );
  }

  requestSurfaceUpdate({ popup = 0, topBar = 0 } = {}) {
    if (topBar) this.topBarSurface.requestUpdate(topBar);
    if (popup) this.popupSurface.requestUpdate(popup);
  }

  reconcileSurfacesNow({ popup = 0, topBar = 0 } = {}) {
    if (topBar) this.topBarSurface.reconcile(topBar);
    if (popup) this.popupSurface.reconcile(popup);
  }

  resetPendingSurfaceUpdates() {
    this.topBarSurface.resetPendingUpdates();
    this.popupSurface.resetPendingUpdates();
  }

  connectPlayerPropertyListeners() {
    this.connectPlayerPropertyListener(MprisPlayerProperties.METADATA, () => {
      this.requestMetadataSurfaceUpdate();
    });
    const updatePlayerIdentity = () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.IDENTITY);
      this.scheduleDesktopAppResolutionRetry();
    };
    this.connectPlayerPropertyListener(
      MprisRootProperties.IDENTITY,
      updatePlayerIdentity,
    );
    this.connectPlayerPropertyListener(
      MprisRootProperties.DESKTOP_ENTRY,
      updatePlayerIdentity,
    );
    this.connectPlayerPropertyListener(
      MprisPlayerProperties.PLAYBACK_STATUS,
      () => {
        this.requestSurfaceUpdate(PlayerSurfaceUpdates.PLAYBACK_STATUS);
        this.popupSurface.syncArtworkPlaybackState();
        this.popupSurface.syncProgressBarPlaybackState();
      },
    );
    this.connectPlayerPropertyListener(MprisPlayerProperties.CAN_PLAY, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.PLAY_PAUSE_CAPABILITY);
    });
    this.connectPlayerPropertyListener(MprisPlayerProperties.CAN_PAUSE, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.PLAY_PAUSE_CAPABILITY);
    });
    this.connectPlayerPropertyListener(MprisPlayerProperties.CAN_SEEK, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.SEEK_CAPABILITY);
    });
    this.connectPlayerPropertyListener(MprisPlayerProperties.CAN_GO_NEXT, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.NEXT_CAPABILITY);
    });
    this.connectPlayerPropertyListener(
      MprisPlayerProperties.CAN_GO_PREVIOUS,
      () => {
        this.requestSurfaceUpdate(PlayerSurfaceUpdates.PREVIOUS_CAPABILITY);
      },
    );
    this.connectPlayerPropertyListener(MprisPlayerProperties.CAN_CONTROL, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.CONTROL_CAPABILITY);
    });
    this.connectPlayerPropertyListener(MprisPlayerProperties.SHUFFLE, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.SHUFFLE);
    });
    this.connectPlayerPropertyListener(MprisPlayerProperties.LOOP_STATUS, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.LOOP_STATUS);
    });
    this.connectPlayerPropertyListener(MprisPlayerProperties.VOLUME, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.VOLUME);
    });
    this.connectPlayerPropertyListener(MprisPlayerStateProperties.IS_PINNED, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.PIN);
    });
    const updatePlaybackSpeedControl = () =>
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.RATE);
    this.connectPlayerPropertyListener(MprisPlayerProperties.RATE, () => {
      this.popupSurface.setPlaybackRate(this.player.rate);
      updatePlaybackSpeedControl();
    });
    this.connectPlayerPropertyListener(
      MprisPlayerProperties.MINIMUM_RATE,
      updatePlaybackSpeedControl,
    );
    this.connectPlayerPropertyListener(
      MprisPlayerProperties.MAXIMUM_RATE,
      updatePlaybackSpeedControl,
    );
    const observedPlayer = this.player;
    this.disconnectPositionChangeListener = observedPlayer.onPositionChanged(
      (positionMicroseconds) => {
        if (this.player !== observedPlayer) return;
        this.popupSurface.setPlaybackPosition(positionMicroseconds);
      },
    );
  }

  requestMetadataSurfaceUpdate() {
    this.requestSurfaceUpdate(
      createMetadataSurfaceUpdate(
        Boolean(this.menu.isOpen && this.settings.popup.progressBarShow),
      ),
    );
  }

  scheduleDesktopAppResolutionRetry() {
    this.cancelDesktopAppResolutionRetry();
    this.desktopAppResolutionRetryAttemptsRemaining =
      DESKTOP_APP_RESOLUTION_RETRY_MAX_ATTEMPTS;

    const observedPlayer = this.player;
    this.desktopAppResolutionRetrySourceId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      DESKTOP_APP_RESOLUTION_RETRY_DELAY_MS,
      () => {
        if (this.player !== observedPlayer) {
          this.desktopAppResolutionRetrySourceId = null;
          this.desktopAppResolutionRetryAttemptsRemaining = 0;
          return GLib.SOURCE_REMOVE;
        }

        // A resolved top-bar icon proves Shell has associated the endpoint with
        // a desktop app. Otherwise retry only a small, bounded number of times.
        if (this.topBarSurface.appIcon.iconKey !== null) {
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

  disconnectPlayerPropertyListeners() {
    this.disconnectPositionChangeListener?.();
    this.disconnectPositionChangeListener = null;

    if (this.player) {
      for (const [
        property,
        listenerId,
      ] of this.playerPropertyListenerIds.entries()) {
        this.player.removePropertyChangeListener(property, listenerId);
      }
    }
    this.playerPropertyListenerIds.clear();
  }

  connectPlayerPropertyListener(property, callback) {
    const observedPlayer = this.player;
    const safeCallback = () => {
      if (this.player !== observedPlayer) return;
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
    const listenerId = observedPlayer.onPropertyChanged(property, safeCallback);
    this.playerPropertyListenerIds.set(property, listenerId);
  }

  destroy() {
    // PanelMenu.Button destroys its PopupMenu children as part of actor teardown.
    // Remove MediaShell-owned sources and listeners first while Shell objects are
    // still valid, then release child owners before the final GObject teardown.
    this.cancelDesktopAppResolutionRetry();
    this.disconnectPlayerPropertyListeners();
    this.resetPendingSurfaceUpdates();

    const pointerHandler = this.pointerHandler;
    const popupSurface = this.popupSurface;
    const topBarSurface = this.topBarSurface;
    this.pointerHandler = null;
    this.popupSurface = null;
    this.topBarSurface = null;
    this.player = null;
    this.mediaRuntime = null;
    this.settings = null;
    this.inputActions = null;

    pointerHandler.destroy();
    popupSurface.destroy();
    topBarSurface.destroy();
    super.destroy();
  }
}

export default GObject.registerClass(MediaShellIndicator);
