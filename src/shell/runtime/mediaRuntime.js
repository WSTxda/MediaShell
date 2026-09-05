/**
 * @file mediaRuntime.js
 * @module shell.runtime.mediaRuntime
 *
 * Composes the MediaShell media domain for one enabled Shell lifecycle.
 *
 * The runtime owns MPRIS discovery/lifecycle, desktop-identity resolution, and
 * canonical playback execution, artwork acquisition/cache, and desktop identity.
 * UI surfaces consume these capabilities instead of constructing protocol services
 * or reaching through ExtensionController.
 */

import { createLogger } from "../../shared/logging/logger.js";
import ArtworkService from "../media/artwork/artworkService.js";
import DesktopAppResolver from "../media/identity/desktopAppResolver.js";
import PlaybackController from "../media/playback/playbackController.js";
import MprisProxyFactory from "../mpris/proxyFactory.js";
import MprisPlayerRegistry from "../mpris/registry.js";

const logger = createLogger("MediaRuntime");

/** Owns the protocol and media capabilities shared by every Shell surface. */
export default class MediaRuntime {
  constructor({ mediaSettings, callbacks = {} } = {}) {
    if (!mediaSettings)
      throw new TypeError("MediaRuntime requires the media settings scope");

    this.mediaSettings = mediaSettings;
    this.blockedAppIds = new Set(mediaSettings.blockedAppIds ?? []);
    this.callbacks = callbacks;
    this.artwork = new ArtworkService({
      getCacheEnabled: () => this.mediaSettings?.artworkCacheEnabled ?? false,
    });
    this.identity = new DesktopAppResolver();
    this.proxyFactory = null;
    this.registry = null;
    this.playback = new PlaybackController(() => this.activePlayer);
    this.unsubscribeBlockedAppsSetting = mediaSettings.subscribe(
      "blockedAppIds",
      (blockedAppIds) => {
        this.setBlockedAppIds(blockedAppIds).catch((error) =>
          logger.warn("Failed to apply the blocked-app list", error),
        );
      },
    );
    this.initialized = false;
  }

  get activePlayer() {
    return this.registry?.activePlayer ?? null;
  }

  get availablePlayers() {
    return this.registry?.getAvailablePlayers() ?? [];
  }

  async init() {
    if (this.initialized) return;

    try {
      this.proxyFactory = new MprisProxyFactory();
      await this.proxyFactory.init();

      this.registry = new MprisPlayerRegistry(
        this.proxyFactory,
        this.identity,
        {
          onAvailablePlayersChanged: () =>
            this.callbacks?.onAvailablePlayersChanged?.(),
          onActivePlayerChanged: (player) =>
            this.callbacks?.onActivePlayerChanged?.(player),
        },
      );
      this.registry.blockedAppIds = new Set(this.blockedAppIds);
      await this.registry.init();
      this.initialized = true;
      logger.debug(
        "Media runtime initialized",
        this.availablePlayers.length,
        "player(s)",
      );
    } catch (error) {
      logger.error("Failed to initialize the media runtime", error);
      this.destroy();
      throw error;
    }
  }

  getAvailablePlayers() {
    return this.availablePlayers;
  }

  selectPlayer(player) {
    return this.registry?.selectPlayer(player) ?? false;
  }

  switchPlayer() {
    return this.registry?.switchPlayer() ?? false;
  }

  togglePlayerPin(player) {
    return this.registry?.togglePlayerPin(player) ?? false;
  }

  async setBlockedAppIds(blockedAppIds) {
    this.blockedAppIds = new Set(blockedAppIds ?? []);
    await this.registry?.setBlockedAppIds(this.blockedAppIds);
  }

  destroy() {
    if (this.initialized) logger.debug("Destroying media runtime");
    this.initialized = false;
    this.callbacks = null;
    this.unsubscribeBlockedAppsSetting?.();
    this.unsubscribeBlockedAppsSetting = null;

    this.registry?.destroy();
    this.registry = null;

    this.proxyFactory?.destroy();
    this.proxyFactory = null;

    this.playback?.destroy();
    this.playback = null;

    this.artwork?.destroy();
    this.artwork = null;

    this.identity?.destroy();
    this.identity = null;
    this.blockedAppIds.clear();
    this.mediaSettings = null;
  }
}
