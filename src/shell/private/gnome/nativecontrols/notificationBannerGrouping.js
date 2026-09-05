/**
 * @file notificationBannerGrouping.js
 * @module shell.private.gnome.nativecontrols.notificationBannerGrouping
 *
 * Owns the reversible notification center banner grouping transaction while
 * Enhance replaces native notification banners. Native ownership is restored on
 * teardown or
 * whenever the private grouping contract becomes invalid.
 */

import { createLogger } from "../../../../shared/logging/logger.js";
import EnhanceNotificationBannerGroup from "./notificationBannerGroup.js";

const logger = createLogger("NotificationBannerGrouping");

export default class NotificationBannerGrouping {
  static create(context, callbacks = {}) {
    if (!context) return null;
    const operations = context.resolveBannerGroupingOperations();
    return operations
      ? new NotificationBannerGrouping(context, operations, callbacks)
      : null;
  }

  constructor(
    context,
    operations,
    {
      beforeTakeOwnership = null,
      onBannerRemoving = null,
      onChanged = null,
      onInvalidated = null,
    } = {},
  ) {
    this.context = context;
    this.operations = operations;
    this.beforeTakeOwnership = beforeTakeOwnership;
    this.onBannerRemoving = onBannerRemoving;
    this.onChanged = onChanged;
    this.onInvalidated = onInvalidated;

    this.group = null;
    this.playerBanners = new Map();
    this.playerSignalIds = new Map();
    this.groupSignalIds = [];
    this.removePlayerOverrides = null;
    this.mounted = false;
    this.ownsPresentation = false;
  }

  getPlayerBanners() {
    return [...this.playerBanners.entries()];
  }

  reconcile() {
    if (!this.context) return;

    const players = this.context.getPlayers();
    if (!players)
      throw new Error("GNOME Shell media player collection became unavailable");

    if (!this.ownsPresentation) this.takeOwnership(players);
    else this.syncPlayers(players);
  }

  takeOwnership(players) {
    const nativeEntries = this.context.getPlayerBanners();
    const currentPlayers = new Set(players);
    const nativePlayers = new Set(nativeEntries.map(([player]) => player));
    const orderedPlayers = [
      ...nativeEntries
        .map(([player]) => player)
        .filter((player) => currentPlayers.has(player)),
      ...players.filter((player) => !nativePlayers.has(player)),
    ];

    this.beforeTakeOwnership?.();

    for (const [player] of nativeEntries) {
      if (this.context.hasBanner(player))
        this.context.callOriginalRemovePlayer(player);
    }

    this.installPlayerOverrides();
    this.ownsPresentation = true;

    for (const player of orderedPlayers) this.addPlayer(player);
    this.syncPlayerMap();
  }

  installPlayerOverrides() {
    this.removePlayerOverrides = this.context.installPlayerOverrides({
      onAddPlayer: (player) => {
        this.handlePlayerMutation("add", player);
        return undefined;
      },
      onRemovePlayer: (player) => {
        this.handlePlayerMutation("remove", player);
        return undefined;
      },
    });
  }

  handlePlayerMutation(mutation, player) {
    try {
      if (mutation === "add") this.addPlayer(player);
      else this.removePlayer(player);
      this.onChanged?.();
    } catch (error) {
      logger.warnOnce(
        "player-mutation-failed",
        "GNOME Shell notification banner grouping lost ownership of a player; restoring native controls",
        error,
      );
      this.invalidate();
    }
  }

  syncPlayers(players) {
    const playerSet = new Set(players);

    for (const player of [...this.playerBanners.keys()]) {
      if (!playerSet.has(player)) this.removePlayer(player);
    }
    for (const player of players) {
      if (!this.playerBanners.has(player)) this.addPlayer(player);
    }

    this.syncPlayerMap();
    this.ensureBestPlayerOnTop();
  }

  addPlayer(player) {
    if (this.playerBanners.has(player)) return;

    this.ensureGroup();
    const banner = this.operations.createNotificationBanner(player);
    if (!this.group.addBanner(banner)) {
      banner.destroy();
      throw new Error("Could not add an owned notification banner to the group");
    }

    this.playerBanners.set(player, banner);
    this.playerSignalIds.set(
      player,
      player.connect("changed", () => this.ensureBestPlayerOnTop()),
    );

    this.syncPlayerMap();
    this.ensureBestPlayerOnTop();
  }

  removePlayer(player) {
    const banner = this.playerBanners.get(player);
    if (!banner) return;

    const signalId = this.playerSignalIds.get(player);
    if (signalId !== undefined) player.disconnect(signalId);
    this.playerSignalIds.delete(player);
    this.playerBanners.delete(player);

    this.onBannerRemoving?.(banner);
    this.group?.removeBanner(banner);

    if (this.playerBanners.size === 0) this.dropGroup();
    else this.ensureBestPlayerOnTop();

    this.syncPlayerMap();
  }

  ensureGroup() {
    if (this.group) return;

    const group = new EnhanceNotificationBannerGroup();
    this.group = group;
    this.groupSignalIds = [
      group.connect("expand-toggle-requested", () => this.toggleGroup(group)),
      group.connect("notify::expanded", () => this.ensureBestPlayerOnTop()),
      group.connect("banner-focused", (_group, actor) =>
        this.operations.emitBannerFocused(actor),
      ),
    ];

    if (!this.operations.mountGroup(group, 0)) {
      this.disconnectGroupSignals(group);
      this.group = null;
      group.destroy();
      throw new Error("Could not mount the Enhance notification banner group");
    }

    this.mounted = true;
    this.syncPlayerMap();
  }

  ensureBestPlayerOnTop() {
    const group = this.group;
    if (!group || group.expanded || group.banners.length < 2) return;

    const isPlaying = (player) => player.status === "Playing";
    const firstBanner = group.banners[0];

    for (const [player, banner] of this.playerBanners) {
      if (banner === firstBanner && isPlaying(player)) return;
    }

    for (const [player, banner] of this.playerBanners) {
      if (!isPlaying(player)) continue;
      group.moveToTop(banner);
      return;
    }
  }

  syncPlayerMap() {
    if (this.group && this.mounted)
      this.operations.setGroupedPlayerMap(this.group);
  }

  toggleGroup(group) {
    if (this.group !== group) return;

    this.operations
      .setExpandedGroup(group.expanded ? null : group)
      .catch((error) =>
        logger.warnOnce(
          "group-toggle-failed",
          "GNOME Shell notification banner group could not change expansion state",
          error,
        ),
      );
  }

  disconnectGroupSignals(group) {
    for (const signalId of this.groupSignalIds) group.disconnect(signalId);
    this.groupSignalIds = [];
  }

  dropGroup() {
    const group = this.group;
    if (!group) return;

    this.group = null;
    this.disconnectGroupSignals(group);

    if (this.operations.isExpandedGroup(group))
      this.operations.collapseExpandedGroup();
    this.operations.clearGroupedPlayerMap(group);

    if (this.mounted) this.operations.removeGroup(group);
    else group.destroy();
    this.mounted = false;
  }

  invalidate() {
    if (!this.context) return;
    const onInvalidated = this.onInvalidated;
    this.destroy();
    onInvalidated?.(this);
  }

  restoreNativeBanners(context) {
    const players = context.getPlayers();
    if (!players) return;

    for (const player of players) {
      if (context.hasBanner(player)) continue;
      try {
        context.callOriginalAddPlayer(player);
      } catch (error) {
        logger.warnOnce(
          "restore-native-player",
          "GNOME Shell notification banner grouping could not restore a native notification banner",
          error,
        );
      }
    }
  }

  destroy({ restoreNative = true } = {}) {
    const context = this.context;
    if (!context) return;
    this.context = null;

    const removePlayerOverrides = this.removePlayerOverrides;
    this.removePlayerOverrides = null;
    removePlayerOverrides?.();

    for (const [player, signalId] of this.playerSignalIds)
      player.disconnect(signalId);
    this.playerSignalIds.clear();

    for (const banner of this.playerBanners.values())
      this.onBannerRemoving?.(banner);

    if (restoreNative) {
      try {
        this.dropGroup();
      } catch (error) {
        logger.warnOnce(
          "restore-native-group",
          "GNOME Shell notification banner group could not be fully removed during restoration",
          error,
        );
      }
      this.restoreNativeBanners(context);
    } else if (this.group) {
      this.disconnectGroupSignals(this.group);
      this.group = null;
      this.mounted = false;
    }

    this.playerBanners.clear();
    this.operations = null;
    this.beforeTakeOwnership = null;
    this.onBannerRemoving = null;
    this.onChanged = null;
    this.onInvalidated = null;
  }
}
