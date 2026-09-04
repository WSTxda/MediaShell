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

import { MediaShellStyleClasses } from "../style.js";
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
  constructor(player, { mediaRuntime, settings, inputActions }) {
    super(0.5, "MediaShell", false);
    this.player = player;
    this.destroyed = false;
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
    this.topBarContent = new TopBarContent(this, surfaceDependencies);
    this.popupContent = new PopupContent(this, surfaceDependencies);
    this.pointerHandler = new IndicatorPointerHandler(this, inputActions);
    this.addPlayerPropertyListeners();
    this.reconcileSurfacesNow(PlayerSurfaceUpdates.ALL);
    this.scheduleDesktopAppResolutionRetry();
    this.pointerHandler.install();
    this.menu.box.add_style_class_name(MediaShellStyleClasses.POPUP_CONTAINER);
  }

  vfunc_event() {
    return Clutter.EVENT_PROPAGATE;
  }

  setPlayer(player) {
    if (
      this.destroyed ||
      !player ||
      this.isActivePlayer(player)
    )
      return;

    this.removePlayerPropertyListeners();
    this.resetPendingSurfaceUpdates();
    this.cancelDesktopAppResolutionRetry();
    this.player = player;
    this.addPlayerPropertyListeners();
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
    if (this.destroyed) return;
    if (topBar) this.topBarContent?.requestUpdate(topBar);
    if (popup) this.popupContent?.requestUpdate(popup);
  }

  reconcileSurfacesNow({ popup = 0, topBar = 0 } = {}) {
    if (this.destroyed) return;
    if (topBar) this.topBarContent?.reconcile(topBar);
    if (popup) this.popupContent?.reconcile(popup);
  }

  resetPendingSurfaceUpdates() {
    this.topBarContent?.resetPendingUpdates();
    this.popupContent?.resetPendingUpdates();
  }

  addPlayerPropertyListeners() {
    this.addPlayerPropertyListener(MprisPlayerProperties.METADATA, () => {
      this.requestMetadataSurfaceUpdate();
    });
    const updatePlayerIdentity = () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.IDENTITY);
      this.scheduleDesktopAppResolutionRetry();
    };
    this.addPlayerPropertyListener(
      MprisRootProperties.IDENTITY,
      updatePlayerIdentity,
    );
    this.addPlayerPropertyListener(
      MprisRootProperties.DESKTOP_ENTRY,
      updatePlayerIdentity,
    );
    this.addPlayerPropertyListener(
      MprisPlayerProperties.PLAYBACK_STATUS,
      () => {
        this.requestSurfaceUpdate(PlayerSurfaceUpdates.PLAYBACK_STATUS);
        this.popupContent.syncAlbumArtPlaybackState();
        this.popupContent.syncProgressBarPlaybackState();
      },
    );
    this.addPlayerPropertyListener(MprisPlayerProperties.CAN_PLAY, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.PLAY_PAUSE_CAPABILITY);
    });
    this.addPlayerPropertyListener(MprisPlayerProperties.CAN_PAUSE, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.PLAY_PAUSE_CAPABILITY);
    });
    this.addPlayerPropertyListener(MprisPlayerProperties.CAN_SEEK, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.SEEK_CAPABILITY);
    });
    this.addPlayerPropertyListener(MprisPlayerProperties.CAN_GO_NEXT, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.NEXT_CAPABILITY);
    });
    this.addPlayerPropertyListener(
      MprisPlayerProperties.CAN_GO_PREVIOUS,
      () => {
        this.requestSurfaceUpdate(PlayerSurfaceUpdates.PREVIOUS_CAPABILITY);
      },
    );
    this.addPlayerPropertyListener(MprisPlayerProperties.CAN_CONTROL, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.CONTROL_CAPABILITY);
    });
    this.addPlayerPropertyListener(MprisPlayerProperties.SHUFFLE, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.SHUFFLE);
    });
    this.addPlayerPropertyListener(MprisPlayerProperties.LOOP_STATUS, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.LOOP_STATUS);
    });
    this.addPlayerPropertyListener(MprisPlayerProperties.VOLUME, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.VOLUME);
    });
    this.addPlayerPropertyListener(MprisPlayerStateProperties.IS_PINNED, () => {
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.PIN);
    });
    const updatePlaybackSpeedControl = () =>
      this.requestSurfaceUpdate(PlayerSurfaceUpdates.RATE);
    this.addPlayerPropertyListener(MprisPlayerProperties.RATE, () => {
      this.popupContent.setPlaybackRate(this.player.rate);
      updatePlaybackSpeedControl();
    });
    this.addPlayerPropertyListener(
      MprisPlayerProperties.MINIMUM_RATE,
      updatePlaybackSpeedControl,
    );
    this.addPlayerPropertyListener(
      MprisPlayerProperties.MAXIMUM_RATE,
      updatePlaybackSpeedControl,
    );
    const observedPlayer = this.player;
    this.disconnectPositionChangeListener = observedPlayer.onPositionChanged(
      (positionMicroseconds) => {
        if (this.player !== observedPlayer) return;
        this.popupContent.setPlaybackPosition(positionMicroseconds);
      },
    );
  }

  requestMetadataSurfaceUpdate() {
    this.requestSurfaceUpdate(
      createMetadataSurfaceUpdate(
        Boolean(
          this.menu?.isOpen && this.settings.popup.progressBarShow,
        ),
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
        if (this.destroyed || this.player !== observedPlayer) {
          this.desktopAppResolutionRetrySourceId = null;
          this.desktopAppResolutionRetryAttemptsRemaining = 0;
          return GLib.SOURCE_REMOVE;
        }

        // A resolved top-bar icon proves Shell has associated the endpoint with
        // a desktop app. Otherwise retry only a small, bounded number of times.
        if (this.topBarContent.appIcon.iconKey !== null) {
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

  removePlayerPropertyListeners() {
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

  addPlayerPropertyListener(property, callback) {
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
    const listenerId = observedPlayer.onPropertyChanged(
      property,
      safeCallback,
    );
    this.playerPropertyListenerIds.set(property, listenerId);
  }

  destroyOwnedResources() {
    if (this.destroyed) return;
    this.destroyed = true;

    this.removePlayerPropertyListeners();
    this.resetPendingSurfaceUpdates();
    this.cancelDesktopAppResolutionRetry();

    const pointerHandler = this.pointerHandler;
    const popupContent = this.popupContent;
    const topBarContent = this.topBarContent;
    this.pointerHandler = null;
    this.popupContent = null;
    this.topBarContent = null;
    this.player = null;
    this.mediaRuntime = null;
    this.settings = null;
    this.inputActions = null;

    pointerHandler?.destroy();
    popupContent?.destroy();
    topBarContent?.destroy();
  }

  destroy() {
    if (this.destroyed) return;

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
