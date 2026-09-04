/**
 * @file registry.js
 * @module shell.mpris.registry
 *
 * Discovers MPRIS bus names, owns MprisPlayer instances, filters blocked apps,
 * and selects the active player.
 *
 * The registry watches NameOwnerChanged, creates MprisPlayer models through
 * MprisProxyFactory,
 * applies blocked-app filtering, and schedules grace-period removals when an
 * endpoint disappears. It is the source of truth for the active player shown by
 * MediaShellIndicator and PopupContent.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import {
  DbusDaemonMethods,
  DbusDaemonSignals,
} from "./dbus.js";
import {
  MPRIS_BUS_NAME_PREFIX,
  MprisPlayerProperties,
  MprisRootProperties,
} from "./protocol.js";
import {
  DBUS_LIST_NAMES_TIMEOUT_MS,
  MPRIS_OWNER_HANDOFF_GRACE_MS,
  MprisPlayerStateProperties,
} from "./clientPolicy.js";
import { normalizeUniqueStrings } from "../../shared/format.js";
import { createLogger } from "../../shared/logging/logger.js";
import { isCancellationError } from "../platform/gioErrors.js";
import MprisPlayer from "./player.js";
import {
  chooseNextPlayer,
  chooseReconciledPlayer,
  orderPlayersDeterministically,
} from "./selection.js";

Gio._promisify(Gio.DBusProxy.prototype, "call", "call_finish");

const logger = createLogger("MprisPlayerRegistry");

/**
 * Discovers MPRIS bus names, owns MprisPlayer instances, filters blocked apps,
 * and selects the active player.
 */
export default class MprisPlayerRegistry {
  constructor(mprisProxyFactory, desktopAppResolver, callbacks = {}) {
    this.mprisProxyFactory = mprisProxyFactory;
    this.desktopAppResolver = desktopAppResolver;
    this.onAvailablePlayersChanged = callbacks.onAvailablePlayersChanged;
    this.onActivePlayerChanged = callbacks.onActivePlayerChanged;
    this.playersByBusName = new Map();
    this.availablePlayers = [];
    this.pendingPlayersByBusName = new Map();
    this.pendingRemovalBusNames = new Set();
    this.pendingRemovalSourceIds = new Map();
    this.pendingRemovalPlayerStateConnections = new Map();
    this.blockedAppIds = new Set();
    this.activePlayer = null;
    this.previousActiveBusName = null;
    this.busDaemonProxy = null;
    this.nameOwnerChangedSignalId = null;
    this.busDaemonOwnerSignalId = null;
    this.operationCancellable = new Gio.Cancellable();
    this.lifecycleGeneration = 0;
  }

  get isDestroyed() {
    return this.operationCancellable === null;
  }

  async init() {
    const lifecycleGeneration = ++this.lifecycleGeneration;
    const busDaemonProxy = await this.mprisProxyFactory.createBusDaemonProxy(
      this.operationCancellable,
    );
    if (this.isDestroyed || lifecycleGeneration !== this.lifecycleGeneration)
      return;
    this.busDaemonProxy = busDaemonProxy;

    this.busDaemonOwnerSignalId = this.busDaemonProxy.connect(
      "notify::g-name-owner",
      () => this.handleBusOwnerChanged(),
    );
    this.nameOwnerChangedSignalId = this.busDaemonProxy.connectSignal(
      DbusDaemonSignals.NAME_OWNER_CHANGED,
      (_proxy, _sender, [busName, _oldOwner, newOwner]) => {
        if (!busName.startsWith(MPRIS_BUS_NAME_PREFIX)) return;

        if (!newOwner) this.schedulePlayerRemoval(busName);
        else this.reconcilePlayerOwner(busName);
      },
    );

    try {
      await this.discoverRunningPlayers();
    } catch (error) {
      if (isCancellationError(error)) return;
      // The owner-change signal remains active, so players can still be
      // discovered later even if the initial ListNames call failed.
      logger.warn("Initial MPRIS player discovery failed", error);
    }
  }

  handleBusOwnerChanged() {
    if (this.isDestroyed || !this.busDaemonProxy) return;

    if (!this.busDaemonProxy.get_name_owner()) {
      for (const busName of this.playersByBusName.keys())
        this.schedulePlayerRemoval(busName);
      return;
    }

    this.discoverRunningPlayers().catch((error) => {
      if (!isCancellationError(error))
        logger.warn(
          "Failed to rediscover MPRIS players after D-Bus recovery",
          error,
        );
    });
  }

  reconcilePlayerOwner(busName) {
    const player = this.playersByBusName.get(busName);
    if (!player) {
      this.registerPlayer(busName).catch((error) => {
        if (!isCancellationError(error))
          logger.warnOnce(
            `register:${busName}`,
            "Failed to add MPRIS player",
            busName,
            error,
          );
      });
      return;
    }

    // Gio.DBusProxy follows the owner of a well-known name, flushes its
    // cached properties when the owner disappears, and reloads them when
    // a new owner appears. Keep the same MprisPlayer and existing surface
    // actors
    // so a direct old-owner -> new-owner hand-off does not destroy and rebuild
    // the top bar between adjacent browser media sessions.
    this.cancelScheduledRemoval(busName);
    player.adoptCurrentNameOwner();
    player.refreshMetadata().catch((error) => {
      if (!isCancellationError(error))
        logger.debugOnce(
          `owner-recovery-metadata:${busName}`,
          "Metadata refresh failed after MPRIS owner recovery",
          busName,
          error,
        );
    });
    this.refreshAvailablePlayers();
    this.reconcileActivePlayer();
  }

  async discoverRunningPlayers() {
    if (!this.busDaemonProxy || this.isDestroyed) return;

    const listNamesResult = await this.busDaemonProxy.call(
      DbusDaemonMethods.LIST_NAMES,
      null,
      Gio.DBusCallFlags.NONE,
      DBUS_LIST_NAMES_TIMEOUT_MS,
      this.operationCancellable,
    );
    const [busNames] = listNamesResult.deepUnpack();
    const playerBusNames = busNames.filter((busName) =>
      busName.startsWith(MPRIS_BUS_NAME_PREFIX),
    );
    const registrationResults = await Promise.allSettled(
      playerBusNames.map((busName) => {
        if (this.playersByBusName.has(busName)) {
          this.reconcilePlayerOwner(busName);
          return Promise.resolve();
        }
        return this.registerPlayer(busName);
      }),
    );

    for (let index = 0; index < registrationResults.length; index++) {
      const registrationResult = registrationResults[index];
      if (registrationResult.status === "rejected")
        logger.warn(
          "A discovered MPRIS player could not be initialized",
          playerBusNames[index],
          registrationResult.reason,
        );
    }
  }

  async registerPlayer(busName) {
    if (
      this.isDestroyed ||
      this.playersByBusName.has(busName) ||
      this.pendingPlayersByBusName.has(busName)
    )
      return;

    const lifecycleGeneration = this.lifecycleGeneration;
    const player = new MprisPlayer(busName, this.mprisProxyFactory);
    let adopted = false;
    this.pendingPlayersByBusName.set(busName, player);

    try {
      const initialized = await player.init();
      if (
        !initialized ||
        player.isDestroyed ||
        this.isDestroyed ||
        lifecycleGeneration !== this.lifecycleGeneration ||
        this.pendingPlayersByBusName.get(busName) !== player
      ) {
        player.destroy();
        return;
      }

      if (
        this.desktopAppResolver.isPlayerBlocked(
          player.identity,
          player.desktopEntry,
          this.blockedAppIds,
          player.busName,
        )
      ) {
        player.destroy();
        return;
      }

      player.onPropertyChanged(MprisPlayerStateProperties.IS_PINNED, () =>
        this.reconcileActivePlayer(),
      );
      player.onPropertyChanged(MprisPlayerProperties.PLAYBACK_STATUS, () =>
        this.reconcileActivePlayer(),
      );
      player.onPropertyChanged(
        MprisPlayerStateProperties.IS_INVALID,
        () => {
          this.refreshAvailablePlayers();
          this.reconcileActivePlayer();
        },
      );
      const revalidateIdentity = () => {
        if (
          this.desktopAppResolver.isPlayerBlocked(
            player.identity,
            player.desktopEntry,
            this.blockedAppIds,
            player.busName,
          )
        ) {
          this.unregisterPlayer(player.busName);
          return;
        }
        // Identity changes can alter the resolved name or icon even
        // when the available proxy list itself is unchanged.
        this.refreshAvailablePlayers(true);
      };
      player.onPropertyChanged(
        MprisRootProperties.IDENTITY,
        revalidateIdentity,
      );
      player.onPropertyChanged(
        MprisRootProperties.DESKTOP_ENTRY,
        revalidateIdentity,
      );

      this.playersByBusName.set(busName, player);
      adopted = true;
      this.refreshAvailablePlayers();
      this.reconcileActivePlayer();
    } catch (error) {
      if (!isCancellationError(error)) throw error;
    } finally {
      if (this.pendingPlayersByBusName.get(busName) === player)
        this.pendingPlayersByBusName.delete(busName);
      if (!adopted && !player.isDestroyed) player.destroy();
    }
  }

  schedulePlayerRemoval(busName) {
    const pendingPlayer = this.pendingPlayersByBusName.get(busName);
    if (pendingPlayer) {
      this.unregisterPlayer(busName);
      return;
    }
    const player = this.playersByBusName.get(busName);
    if (!player || this.pendingRemovalSourceIds.has(busName)) return;

    this.pendingRemovalBusNames.add(busName);

    // D-Bus ownership is the lifecycle authority. Hide the ownerless
    // endpoint from the selector immediately, but retain the active player
    // for a bounded hand-off window so a replacement owner can reuse it.
    this.refreshAvailablePlayers();
    this.reconcileActivePlayer();

    // Shell.App state may only corroborate the D-Bus owner loss when MPRIS
    // supplies an exact DesktopEntry. Presentation heuristics are explicitly
    // excluded from lifecycle decisions.
    if (this.observeExactPlayerShutdown(busName, player)) return;

    const sourceId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      MPRIS_OWNER_HANDOFF_GRACE_MS,
      () => {
        this.pendingRemovalSourceIds.delete(busName);
        const player = this.playersByBusName.get(busName);
        if (player?.hasBusOwner) this.reconcilePlayerOwner(busName);
        else {
          this.unregisterPlayer(busName);
        }
        return GLib.SOURCE_REMOVE;
      },
    );
    this.pendingRemovalSourceIds.set(busName, sourceId);
  }

  observeExactPlayerShutdown(busName, player) {
    const shellApp = this.desktopAppResolver.resolveLifecycleShellApp(
      player.desktopEntry,
    );
    const removeIfStopped = () => {
      if (
        !this.pendingRemovalBusNames.has(busName) ||
        !this.desktopAppResolver.isShellAppStopped(shellApp)
      )
        return false;

      this.unregisterPlayer(busName);
      return true;
    };

    if (removeIfStopped()) return true;
    if (!shellApp || typeof shellApp.connect !== "function") return false;

    try {
      const stateSignalId = shellApp.connect("notify::state", removeIfStopped);
      this.pendingRemovalPlayerStateConnections.set(busName, {
        shellApp,
        stateSignalId,
      });

      // Close the race between the initial state read and signal
      // connection without introducing polling.
      return removeIfStopped();
    } catch (error) {
      logger.debugOnce(
        `shell-app-state:${busName}`,
        "Could not observe exact Shell app state during MPRIS hand-off",
        busName,
        error,
      );
      return false;
    }
  }

  cancelScheduledRemoval(busName) {
    let canceled = false;
    const sourceId = this.pendingRemovalSourceIds.get(busName);
    if (sourceId !== undefined) {
      GLib.Source.remove(sourceId);
      this.pendingRemovalSourceIds.delete(busName);
      canceled = true;
    }

    const stateSignal = this.pendingRemovalPlayerStateConnections.get(busName);
    if (stateSignal) {
      stateSignal.shellApp.disconnect(stateSignal.stateSignalId);
      this.pendingRemovalPlayerStateConnections.delete(busName);
      canceled = true;
    }

    if (this.pendingRemovalBusNames.delete(busName)) canceled = true;
    return canceled;
  }

  unregisterPlayer(busName) {
    this.cancelScheduledRemoval(busName);
    const pendingPlayer = this.pendingPlayersByBusName.get(busName);
    if (pendingPlayer) {
      pendingPlayer.destroy();
      this.pendingPlayersByBusName.delete(busName);
    }

    const player = this.playersByBusName.get(busName);
    if (!player) return;

    player.destroy();
    this.playersByBusName.delete(busName);
    this.refreshAvailablePlayers();
    this.reconcileActivePlayer();
  }

  refreshAvailablePlayers(forceNotification = false) {
    const nextAvailablePlayers = orderPlayersDeterministically(
      [...this.playersByBusName.values()].filter(
        (player) =>
          !player.isInvalid &&
          !this.pendingRemovalBusNames.has(player.busName),
      ),
    );
    const listChanged =
      nextAvailablePlayers.length !== this.availablePlayers.length ||
      nextAvailablePlayers.some(
        (player, index) => player !== this.availablePlayers[index],
      );
    if (!listChanged && !forceNotification) return false;

    this.availablePlayers = nextAvailablePlayers;
    this.invokeCallbackSafely(
      this.onAvailablePlayersChanged,
      this.availablePlayers,
      "available-players-changed",
    );
    return true;
  }

  getAvailablePlayers() {
    return this.availablePlayers;
  }

  getPinnedPlayer() {
    return (
      orderPlayersDeterministically([
        ...this.playersByBusName.values(),
      ]).find((player) => player.isPinned) ?? null
    );
  }

  isRegisteredPlayer(player) {
    return Boolean(
      !this.isDestroyed &&
      player &&
      !player.isInvalid &&
      !this.pendingRemovalBusNames.has(player.busName) &&
      this.playersByBusName.get(player.busName) === player,
    );
  }

  #setActivePlayer(player, { remember = true } = {}) {
    if (player && remember) this.previousActiveBusName = player.busName;
    if (this.activePlayer === player) return false;

    this.activePlayer = player;
    this.invokeCallbackSafely(
      this.onActivePlayerChanged,
      player,
      "active-player-changed",
    );
    return true;
  }

  selectPlayer(player) {
    if (!this.isRegisteredPlayer(player)) return false;

    const pinnedPlayer = this.getPinnedPlayer();
    if (pinnedPlayer && pinnedPlayer !== player) return false;

    this.#setActivePlayer(player);
    return true;
  }

  switchPlayer() {
    if (this.getPinnedPlayer()) return false;

    const targetPlayer = chooseNextPlayer(
      this.getAvailablePlayers(),
      this.activePlayer,
    );
    return targetPlayer ? this.selectPlayer(targetPlayer) : false;
  }

  pinPlayer(player) {
    if (!this.isRegisteredPlayer(player)) return false;

    const pinnedPlayer = this.getPinnedPlayer();
    if (pinnedPlayer && pinnedPlayer !== player) {
      return false;
    }
    if (!this.selectPlayer(player)) return false;
    if (player.isPinned) return true;

    player.pin();
    return true;
  }

  unpinPlayer(player) {
    if (
      this.isDestroyed ||
      !player ||
      this.playersByBusName.get(player.busName) !== player ||
      !player.isPinned
    )
      return false;

    player.unpin();
    return true;
  }

  togglePlayerPin(player) {
    if (!player) return false;
    return player.isPinned
      ? this.unpinPlayer(player)
      : this.pinPlayer(player);
  }

  reconcileActivePlayer() {
    const pendingActivePlayer =
      this.previousActiveBusName &&
      this.pendingRemovalBusNames.has(this.previousActiveBusName)
        ? (this.playersByBusName.get(this.previousActiveBusName) ?? null)
        : null;
    const nextActivePlayer = chooseReconciledPlayer(
      this.availablePlayers,
      this.previousActiveBusName,
      pendingActivePlayer,
    );

    // Preserve the previous bus name while the UI is intentionally empty
    // during an owner hand-off. A real replacement updates it normally.
    this.#setActivePlayer(nextActivePlayer, {
      remember: nextActivePlayer !== null,
    });
  }

  invokeCallbackSafely(callback, value, eventName) {
    try {
      callback?.(value);
    } catch (error) {
      logger.errorOnce(
        `callback:${eventName}`,
        `Registry callback failed: ${eventName}`,
        error,
      );
    }
  }

  async setBlockedAppIds(blockedAppIds) {
    this.blockedAppIds = new Set(normalizeUniqueStrings(blockedAppIds));

    for (const player of [...this.playersByBusName.values()]) {
      if (
        this.desktopAppResolver.isPlayerBlocked(
          player.identity,
          player.desktopEntry,
          this.blockedAppIds,
          player.busName,
        )
      ) {
        this.unregisterPlayer(player.busName);
      }
    }

    try {
      await this.discoverRunningPlayers();
    } catch (error) {
      if (!isCancellationError(error))
        logger.warn(
          "Failed to refresh players after blocked-app change",
          error,
        );
    }
  }

  destroy() {
    const operationCancellable = this.operationCancellable;
    if (!operationCancellable) return;

    this.operationCancellable = null;
    this.lifecycleGeneration++;
    operationCancellable.cancel();

    if (this.busDaemonProxy && this.nameOwnerChangedSignalId !== null)
      this.busDaemonProxy.disconnectSignal(this.nameOwnerChangedSignalId);
    if (this.busDaemonProxy && this.busDaemonOwnerSignalId !== null)
      this.busDaemonProxy.disconnect(this.busDaemonOwnerSignalId);

    for (const busName of [...this.pendingRemovalBusNames])
      this.cancelScheduledRemoval(busName);
    this.pendingRemovalSourceIds.clear();
    this.pendingRemovalPlayerStateConnections.clear();
    this.pendingRemovalBusNames.clear();

    for (const player of this.playersByBusName.values()) player.destroy();
    for (const player of this.pendingPlayersByBusName.values())
      player.destroy();

    this.playersByBusName.clear();
    this.availablePlayers = [];
    this.pendingPlayersByBusName.clear();
    this.activePlayer = null;
    this.previousActiveBusName = null;
    this.busDaemonProxy = null;
    this.desktopAppResolver = null;
    this.nameOwnerChangedSignalId = null;
    this.busDaemonOwnerSignalId = null;
    this.onAvailablePlayersChanged = null;
    this.onActivePlayerChanged = null;
    this.mprisProxyFactory = null;
  }
}
