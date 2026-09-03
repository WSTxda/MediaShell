/**
 * @file gnomeShellMediaGrouping.js
 * @module shell.services.gnomeShellMediaGrouping
 *
 * Owns notification-list grouping while Enhance replaces native media messages.
 */

import { createLogger } from "../../shared/utils/log.js";
import EnhancedMediaMessageGroup from "../ui/notifications/enhancedMediaMessageGroup.js";

const logger = createLogger("GnomeShellMediaGrouping");

export default class GnomeShellMediaGrouping {
  static create(context, callbacks = {}) {
    if (!context) return null;
    const operations = context.resolveGroupingOperations();
    return operations
      ? new GnomeShellMediaGrouping(context, operations, callbacks)
      : null;
  }

  constructor(
    context,
    operations,
    {
      beforeTakeOwnership = null,
      onMessageRemoving = null,
      onChanged = null,
      onInvalidated = null,
    } = {},
  ) {
    this.context = context;
    this.operations = operations;
    this.beforeTakeOwnership = beforeTakeOwnership;
    this.onMessageRemoving = onMessageRemoving;
    this.onChanged = onChanged;
    this.onInvalidated = onInvalidated;

    this.group = null;
    this.playerMessages = new Map();
    this.playerSignalIds = new Map();
    this.groupSignalIds = [];
    this.removePlayerOverrides = null;
    this.mounted = false;
    this.ownsPresentation = false;
  }

  getPlayerMessages() {
    return [...this.playerMessages.entries()];
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
    const nativeEntries = this.context.getPlayerMessages();
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
      if (this.context.hasMessage(player))
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
        "GNOME Shell media grouping lost ownership of a player; restoring native media controls",
        error,
      );
      this.invalidate();
    }
  }

  syncPlayers(players) {
    const playerSet = new Set(players);

    for (const player of [...this.playerMessages.keys()]) {
      if (!playerSet.has(player)) this.removePlayer(player);
    }
    for (const player of players) {
      if (!this.playerMessages.has(player)) this.addPlayer(player);
    }

    this.syncPlayerMap();
    this.ensureBestPlayerOnTop();
  }

  addPlayer(player) {
    if (this.playerMessages.has(player)) return;

    this.ensureGroup();
    const message = this.operations.createMediaMessage(player);
    if (!this.group.addMessage(message)) {
      message.destroy();
      throw new Error("Could not add an owned media message to the group");
    }

    this.playerMessages.set(player, message);
    this.playerSignalIds.set(
      player,
      player.connect("changed", () => this.ensureBestPlayerOnTop()),
    );

    this.syncPlayerMap();
    this.ensureBestPlayerOnTop();
  }

  removePlayer(player) {
    const message = this.playerMessages.get(player);
    if (!message) return;

    const signalId = this.playerSignalIds.get(player);
    if (signalId !== undefined) player.disconnect(signalId);
    this.playerSignalIds.delete(player);
    this.playerMessages.delete(player);

    this.onMessageRemoving?.(message);
    this.group?.removeMessage(message);

    if (this.playerMessages.size === 0) this.dropGroup();
    else this.ensureBestPlayerOnTop();

    this.syncPlayerMap();
  }

  ensureGroup() {
    if (this.group) return;

    const group = new EnhancedMediaMessageGroup();
    this.group = group;
    this.groupSignalIds = [
      group.connect("expand-toggle-requested", () => this.toggleGroup(group)),
      group.connect("notify::expanded", () => this.ensureBestPlayerOnTop()),
      group.connect("message-focused", (_group, actor) =>
        this.operations.emitMessageFocused(actor),
      ),
    ];

    if (!this.operations.mountGroup(group, 0)) {
      this.disconnectGroupSignals(group);
      this.group = null;
      group.destroy();
      throw new Error("Could not mount the enhanced media group");
    }

    this.mounted = true;
    this.syncPlayerMap();
  }

  ensureBestPlayerOnTop() {
    const group = this.group;
    if (!group || group.expanded || group.messages.length < 2) return;

    const isPlaying = (player) => player.status === "Playing";
    const firstMessage = group.messages[0];

    for (const [player, message] of this.playerMessages) {
      if (message === firstMessage && isPlaying(player)) return;
    }

    for (const [player, message] of this.playerMessages) {
      if (!isPlaying(player)) continue;
      group.moveToTop(message);
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
          "GNOME Shell media group could not change expansion state",
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

  restoreNativePlayers(context) {
    const players = context.getPlayers();
    if (!players) return;

    for (const player of players) {
      if (context.hasMessage(player)) continue;
      try {
        context.callOriginalAddPlayer(player);
      } catch (error) {
        logger.warnOnce(
          "restore-native-player",
          "GNOME Shell media grouping could not restore a native media message",
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

    for (const message of this.playerMessages.values())
      this.onMessageRemoving?.(message);

    if (restoreNative) {
      try {
        this.dropGroup();
      } catch (error) {
        logger.warnOnce(
          "restore-native-group",
          "GNOME Shell media group could not be fully removed during restoration",
          error,
        );
      }
      this.restoreNativePlayers(context);
    } else if (this.group) {
      this.disconnectGroupSignals(this.group);
      this.group = null;
      this.mounted = false;
    }

    this.playerMessages.clear();
    this.operations = null;
    this.beforeTakeOwnership = null;
    this.onMessageRemoving = null;
    this.onChanged = null;
    this.onInvalidated = null;
  }
}
