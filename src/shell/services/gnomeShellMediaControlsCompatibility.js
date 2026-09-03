/**
 * @file gnomeShellMediaControlsCompatibility.js
 * @module shell.services.gnomeShellMediaControlsCompatibility
 *
 * Resolves the private GNOME Shell media contracts used by Hide and Enhance.
 */

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Config from "resource:///org/gnome/shell/misc/config.js";
import { InjectionManager } from "resource:///org/gnome/shell/extensions/extension.js";

const ADD_PLAYER_METHOD = "_addPlayer";
const REMOVE_PLAYER_METHOD = "_removePlayer";
const ADD_MESSAGE_AT_INDEX_METHOD = "_addMessageAtIndex";
const REMOVE_MESSAGE_METHOD = "_removeMessage";
const SET_EXPANDED_GROUP_METHOD = "_setExpandedGroup";
const COLLAPSE_METHOD = "collapse";
const UPDATE_EXPAND_BUTTON_METHOD = "_updateExpandButton";
const LOCK_SCREEN_SHOWN_SIGNAL = "lock-screen-shown";
const LOCK_SCREEN_MEDIA_MINIMUM_SHELL_MAJOR = 49;

/** Returns whether this Shell generation provides unlock-dialog media players. */
export function supportsLockScreenMediaContext() {
  return (
    Number.parseInt(Config.PACKAGE_VERSION, 10) >=
    LOCK_SCREEN_MEDIA_MINIMUM_SHELL_MAJOR
  );
}

function resolveMethod(target, methodName) {
  let methodTarget = target;
  while (methodTarget && !Object.hasOwn(methodTarget, methodName))
    methodTarget = Object.getPrototypeOf(methodTarget);

  const originalMethod = methodTarget?.[methodName];
  if (typeof originalMethod !== "function") return null;

  return Object.freeze({
    target: methodTarget,
    name: methodName,
    originalMethod,
  });
}

function resolvePlayers(mediaSource) {
  const players = mediaSource.players;
  return Array.isArray(players) ? [...players] : null;
}

function resolvePlayerBusName(player) {
  const busName = player?._busName;
  return typeof busName === "string" && busName ? busName : null;
}

function isSignalOwner(candidate) {
  return (
    candidate &&
    typeof candidate.connect === "function" &&
    typeof candidate.disconnect === "function"
  );
}

function installPlayerOverrides(
  messageView,
  addPlayerMethod,
  removePlayerMethod,
  { onAddPlayer, onRemovePlayer },
) {
  const injectionManager = new InjectionManager();

  const createOverride = (handler) => (originalMethod) => {
    return function (player, ...args) {
      if (this !== messageView)
        return originalMethod.call(this, player, ...args);
      return handler(player, ...args);
    };
  };

  try {
    injectionManager.overrideMethod(
      addPlayerMethod.target,
      addPlayerMethod.name,
      createOverride(onAddPlayer),
    );
    injectionManager.overrideMethod(
      removePlayerMethod.target,
      removePlayerMethod.name,
      createOverride(onRemovePlayer),
    );
  } catch (error) {
    injectionManager.clear();
    throw error;
  }

  let activeInjectionManager = injectionManager;
  return () => {
    if (!activeInjectionManager) return;
    activeInjectionManager.clear();
    activeInjectionManager = null;
  };
}

/**
 * Resolves the notification-list MessageView media context used by Shell 48+.
 *
 * @returns {object|null} Compatible notification-list media context.
 */
export function resolveNotificationListMediaContext() {
  const messageView =
    Main.panel.statusArea.dateMenu?._messageList?._messageView ?? null;
  const mediaSource = messageView?._mediaSource ?? null;
  const playerToMessage = messageView?._playerToMessage ?? null;
  const addPlayerMethod = messageView
    ? resolveMethod(messageView, ADD_PLAYER_METHOD)
    : null;
  const removePlayerMethod = messageView
    ? resolveMethod(messageView, REMOVE_PLAYER_METHOD)
    : null;

  if (
    !isSignalOwner(messageView) ||
    !isSignalOwner(mediaSource) ||
    !addPlayerMethod ||
    !removePlayerMethod ||
    typeof playerToMessage?.has !== "function" ||
    typeof playerToMessage?.keys !== "function" ||
    typeof playerToMessage?.entries !== "function"
  )
    return null;

  if (!resolvePlayers(mediaSource)) return null;

  return Object.freeze({
    owner: messageView,
    mediaSource,
    getPlayers: () => resolvePlayers(mediaSource),
    getPlayersWithMessages: () => [...playerToMessage.keys()],
    getPlayerMessages: () => [...playerToMessage.entries()],
    hasMessage: (player) => playerToMessage.has(player),
    callOriginalAddPlayer: (player) =>
      addPlayerMethod.originalMethod.call(messageView, player),
    callOriginalRemovePlayer: (player) =>
      removePlayerMethod.originalMethod.call(messageView, player),
    installPlayerOverrides: (handlers) =>
      installPlayerOverrides(
        messageView,
        addPlayerMethod,
        removePlayerMethod,
        handlers,
      ),
    resolveGroupingOperations: () =>
      resolveNotificationListGroupingContext(messageView),
  });
}

/**
 * Resolves the MessageView contract needed by Enhance grouping.
 *
 * The native MediaMessage constructor is learned from the current MessageView
 * instead of importing Shell's private messageList module. This keeps private
 * module layout out of MediaShell's load path and follows the active Shell.
 *
 * @param {object} messageView - Notification-list MessageView from the base context.
 * @returns {object|null} Compatible grouping operations, when available.
 */
function resolveNotificationListGroupingContext(messageView) {
  const messages = messageView?.messages ?? null;
  const playerToMessage = messageView?._playerToMessage ?? null;
  const addMessageAtIndexMethod = messageView
    ? resolveMethod(messageView, ADD_MESSAGE_AT_INDEX_METHOD)
    : null;
  const removeMessageMethod = messageView
    ? resolveMethod(messageView, REMOVE_MESSAGE_METHOD)
    : null;
  const setExpandedGroupMethod = messageView
    ? resolveMethod(messageView, SET_EXPANDED_GROUP_METHOD)
    : null;
  const collapseMethod = messageView
    ? resolveMethod(messageView, COLLAPSE_METHOD)
    : null;

  if (
    !isSignalOwner(messageView) ||
    !Array.isArray(messages) ||
    typeof playerToMessage?.clear !== "function" ||
    typeof playerToMessage?.set !== "function" ||
    typeof playerToMessage?.get !== "function" ||
    typeof playerToMessage?.delete !== "function" ||
    typeof playerToMessage?.values !== "function" ||
    !addMessageAtIndexMethod ||
    !removeMessageMethod ||
    !setExpandedGroupMethod
  )
    return null;

  const nativeMessage = [...playerToMessage.values()].find(
    (message) => message && typeof message.constructor === "function",
  );
  const MediaMessageClass = nativeMessage?.constructor ?? null;
  if (!MediaMessageClass) return null;

  return Object.freeze({
    createMediaMessage: (player) => new MediaMessageClass(player),
    mountGroup: (group, index = 0) => {
      if (group.get_parent() || messages.includes(group)) return false;

      addMessageAtIndexMethod.originalMethod.call(
        messageView,
        group,
        Math.min(Math.max(0, index), messages.length),
      );
      return messages.includes(group);
    },
    removeGroup: (group) => {
      if (!group || !messages.includes(group)) return false;
      removeMessageMethod.originalMethod.call(messageView, group);
      return true;
    },
    setExpandedGroup: (group) =>
      Promise.resolve(
        setExpandedGroupMethod.originalMethod.call(messageView, group),
      ),
    isExpandedGroup: (group) => messageView.expandedGroup === group,
    collapseExpandedGroup: () => {
      if (collapseMethod)
        return collapseMethod.originalMethod.call(messageView);
      return setExpandedGroupMethod.originalMethod.call(messageView, null);
    },
    emitMessageFocused: (actor) => messageView.emit("message-focused", actor),
    setGroupedPlayerMap: (group) => {
      playerToMessage.clear();
      playerToMessage.set(group, group);
    },
    clearGroupedPlayerMap: (group) => {
      if (playerToMessage.get(group) === group) playerToMessage.delete(group);
    },
  });
}

/**
 * Resolves the native lock-screen media context available in Shell 49+.
 * Shell 48 has no equivalent player collection and is rejected before lookup.
 *
 * @returns {object|null} Compatible lock-screen media context, when available.
 */
export function resolveLockScreenMediaContext() {
  if (!supportsLockScreenMediaContext()) return null;

  const notificationsBox =
    Main.screenShield?._dialog?._notificationsBox ?? null;
  const mediaSource = notificationsBox?._mediaSource ?? null;
  const playerToMessage = notificationsBox?._players ?? null;

  if (
    !isSignalOwner(notificationsBox) ||
    !isSignalOwner(mediaSource) ||
    typeof playerToMessage?.entries !== "function"
  )
    return null;

  if (!resolvePlayers(mediaSource)) return null;

  return Object.freeze({
    owner: notificationsBox,
    mediaSource,
    getPlayerMessages: () => [...playerToMessage.entries()],
  });
}

/**
 * Watches for the native lock-screen media surface becoming available.
 *
 * @param {Function} callback - Called after Shell reports the lock screen.
 * @returns {(() => void) | null} Disconnect callback, when supported.
 */
export function connectLockScreenShown(callback) {
  const screenShield = Main.screenShield ?? null;
  if (!isSignalOwner(screenShield)) return null;

  let signalId = screenShield.connect(LOCK_SCREEN_SHOWN_SIGNAL, callback);
  return () => {
    if (signalId === null) return;
    screenShield.disconnect(signalId);
    signalId = null;
  };
}

/**
 * Resolves the private MediaMessage structure required by the binding.
 *
 * @param {object} message - Native GNOME Shell MediaMessage-like actor.
 * @returns {object|null} Compatible MediaMessage context, when available.
 */
export function resolveMediaMessageContext(message) {
  const nativePlayer = message?._player ?? null;
  const busName = resolvePlayerBusName(nativePlayer);
  const nativeIcon = message?._icon ?? null;
  const nativeMediaControls = message?._mediaControls ?? null;
  const actionBin = message?._actionBin ?? null;
  const messageBox = nativeMediaControls
    ? nativeMediaControls.get_parent()
    : null;
  const nativeExpandButton = message?._header?.expandButton ?? null;
  const updateExpandButtonMethod = message
    ? resolveMethod(message, UPDATE_EXPAND_BUTTON_METHOD)
    : null;
  const titleLabel = message?.titleLabel ?? null;
  const themeSource =
    titleLabel && typeof titleLabel.get_theme_node === "function"
      ? titleLabel
      : message;

  if (
    !message ||
    !nativePlayer ||
    !busName ||
    !nativeIcon ||
    !nativeMediaControls ||
    !actionBin ||
    !messageBox ||
    !nativeExpandButton ||
    !updateExpandButtonMethod ||
    !themeSource ||
    nativeIcon.get_parent() !== messageBox ||
    typeof message.setActionArea !== "function" ||
    typeof message.expand !== "function" ||
    typeof message.unexpand !== "function" ||
    typeof messageBox.insert_child_below !== "function" ||
    typeof themeSource.get_theme_node !== "function"
  )
    return null;

  const currentActionArea = actionBin.child ?? null;
  if (currentActionArea) return null;

  const requestPresentationUpdate = () => {
    const wrapper = message.get_parent();
    for (const actor of [messageBox, actionBin, message, wrapper]) {
      if (!actor) continue;
      actor.queue_relayout();
      actor.queue_redraw();
    }
  };

  return Object.freeze({
    message,
    busName,
    nativeIcon,
    nativeMediaControls,
    themeSource,
    getActionArea: () => actionBin.child ?? null,
    setActionArea: (actor) => message.setActionArea(actor ?? null),
    getExpanded: () => Boolean(message.expanded),
    setExpanded: (expanded) => {
      if (Boolean(message.expanded) === Boolean(expanded)) return;
      if (expanded) message.expand(false);
      else message.unexpand(false);
      requestPresentationUpdate();
    },
    getExpandButtonOpacity: () => Number(nativeExpandButton.opacity),
    setExpandButtonOpacity: (opacity) => {
      nativeExpandButton.opacity = opacity;
      nativeExpandButton.queue_redraw();
    },
    refreshExpandButton: () => {
      updateExpandButtonMethod.originalMethod.call(message);
      requestPresentationUpdate();
    },
    getForegroundColor: () =>
      themeSource.get_theme_node().get_foreground_color(),
    requestPresentationUpdate,
    insertBeforeNativeIcon: (actor) =>
      messageBox.insert_child_below(actor, nativeIcon),
    insertBeforeNativeMediaControls: (actor) =>
      messageBox.insert_child_below(actor, nativeMediaControls),
  });
}
