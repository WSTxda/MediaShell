/**
 * @file mediaRuntime.js
 * @module shell.runtime.mediaRuntime
 *
 * Composes the MediaShell media domain for one Shell runtime profile.
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
  constructor({
    blockedAppIds = [],
    getArtworkCacheEnabled = () => false,
    callbacks = {},
  } = {}) {
    this.blockedAppIds = new Set(blockedAppIds ?? []);
    this.callbacks = callbacks;
    this.artwork = new ArtworkService({
      getCacheEnabled: getArtworkCacheEnabled,
    });
    this.identity = new DesktopAppResolver();
    this.proxyFactory = null;
    this.registry = null;
    this.playback = new PlaybackController(() => this.activePlayer);
    this.initialized = false;
  }

  get activePlayer() {
    return this.registry?.activeMediaApp ?? null;
  }

  get availablePlayers() {
    return this.registry?.getAvailableMediaApps() ?? [];
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
          onAvailableMediaAppsChanged: () =>
            this.callbacks?.onAvailablePlayersChanged?.(),
          onActiveMediaAppChanged: (player) =>
            this.callbacks?.onActivePlayerChanged?.(player),
        },
      );
      this.registry.blockedAppIds = new Set(this.blockedAppIds);
      await this.registry.init();
      this.initialized = true;
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
    return this.registry?.selectMediaApp(player) ?? false;
  }

  switchPlayer() {
    return this.registry?.switchMediaApp() ?? false;
  }

  togglePlayerPin(player) {
    return this.registry?.toggleMediaAppPin(player) ?? false;
  }

  async setBlockedAppIds(blockedAppIds) {
    this.blockedAppIds = new Set(blockedAppIds ?? []);
    await this.registry?.setBlockedAppIds(this.blockedAppIds);
  }

  destroy() {
    this.initialized = false;
    this.callbacks = null;

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
  }
}
