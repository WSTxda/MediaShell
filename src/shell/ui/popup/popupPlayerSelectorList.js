/**
 * @file popupPlayerSelectorList.js
 * @module shell.ui.popup.popupPlayerSelectorList
 *
 * Builds the popup list of available MPRIS players.
 *
 * The list owns row creation, active-row styling, pin controls, and reveal
 * animation for the player selector. It receives MprisPlayer state and the
 * injected lifecycle-scoped desktop-app resolver, then emits user
 * intent without changing MprisPlayerRegistry directly.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";

import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import {
  MediaShellStyleClasses,
  NativeStyleClasses,
  styleClassNames,
} from "../style.js";
import { IconNames } from "../../../shared/icons.js";
import {
  ACTIVE_OPACITY,
  HIDDEN_OPACITY,
  INACTIVE_OPACITY,
} from "../actorState.js";
import {
  POPUP_PLAYER_SELECTOR_REVEAL_DURATION_MS,
  POPUP_PLAYER_SELECTOR_ROW_ANIMATION_MS,
} from "./presentation.js";
import { createIcon } from "../icons.js";

function actorContainsDescendant(actor, candidateDescendant) {
  return (
    actor != null &&
    candidateDescendant != null &&
    (actor === candidateDescendant || actor.contains(candidateDescendant))
  );
}

function actorContainsEventPoint(actor, event) {
  if (!actor) return false;
  const [eventX, eventY] = event.get_coords();
  const [actorX, actorY] = actor.get_transformed_position();
  const [actorWidth, actorHeight] = actor.get_transformed_size();
  return (
    eventX >= actorX &&
    eventX <= actorX + actorWidth &&
    eventY >= actorY &&
    eventY <= actorY + actorHeight
  );
}

function resolvePlayerRows(players, desktopAppResolver) {
  return players.map((player) => {
    const desktopApp = desktopAppResolver.resolveDesktopApp(
      player.identity,
      player.desktopEntry,
      player.busName,
    );
    return {
      player,
      desktopApp,
      resolvedDesktopAppKey:
        desktopApp && desktopAppResolver.hasResolvedDesktopAppIcon(desktopApp)
          ? player.busName
          : null,
    };
  });
}

/**
 * Builds the popup list of available MPRIS players.
 */
export default class PopupPlayerSelectorList {
  constructor(popupSurface, playerSelectorButton, desktopAppResolver) {
    this.popupSurface = popupSurface;
    this.playerSelectorButton = playerSelectorButton;
    this.revealer = null;
    this.card = null;
    this.renderSignature = null;
    this.desktopAppResolver = desktopAppResolver;
  }

  get settings() {
    return this.popupSurface.settings;
  }
  get popupItem() {
    return this.popupSurface.popupItem;
  }
  get isOpen() {
    return this.revealer != null;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    const players = this.popupSurface.mediaRuntime?.getAvailablePlayers() ?? [];
    if (players.length <= 1) return;

    this.revealer = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: MediaShellStyleClasses.POPUP_PLAYER_SELECTOR_REVEALER,
      clipToAllocation: true,
    });
    this.card = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: MediaShellStyleClasses.POPUP_PLAYER_SELECTOR_CARD,
    });
    this.syncPlayerSelectorListWidth();
    const resolvedPlayerRows = resolvePlayerRows(
      players,
      this.desktopAppResolver,
    );
    this.card.add_child(this.buildPlayerList(resolvedPlayerRows));
    this.renderSignature = this.getRenderSignature(resolvedPlayerRows);
    this.revealer.add_child(this.card);

    const children = this.popupItem.get_children();
    const selectorButtonIndex = children.indexOf(
      this.playerSelectorButton.actor,
    );
    this.popupItem.insert_child_at_index(
      this.revealer,
      selectorButtonIndex < 0 ? 0 : selectorButtonIndex + 1,
    );
    this.animateOpen();
  }

  animateOpen() {
    if (!this.revealer) return;
    const [, naturalHeight] = this.revealer.get_preferred_height(-1);
    this.revealer.height = 0;
    this.revealer.translation_y = -6;
    this.revealer.ease({
      height: naturalHeight,
      translation_y: 0,
      duration: POPUP_PLAYER_SELECTOR_REVEAL_DURATION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => {
        if (this.revealer) this.revealer.clipToAllocation = false;
      },
    });
  }

  refreshPlayers() {
    if (!this.revealer) return;
    const players = this.popupSurface.mediaRuntime?.getAvailablePlayers() ?? [];
    if (players.length <= 1) {
      this.close();
      return;
    }
    if (!this.card) return;

    this.syncPlayerSelectorListWidth();
    const resolvedPlayerRows = resolvePlayerRows(
      players,
      this.desktopAppResolver,
    );
    const renderSignature = this.getRenderSignature(resolvedPlayerRows);
    if (renderSignature !== null && renderSignature === this.renderSignature)
      return;

    this.card.remove_all_children();
    this.card.add_child(this.buildPlayerList(resolvedPlayerRows));
    this.renderSignature = renderSignature;
    const [, naturalHeight] = this.revealer.get_preferred_height(-1);
    this.revealer.height = naturalHeight;
    this.revealer.translation_y = 0;
    this.revealer.clipToAllocation = false;
  }

  getRenderSignature(resolvedPlayerRows) {
    const resolvedDesktopAppKeys = resolvedPlayerRows.map(
      ({ resolvedDesktopAppKey }) => resolvedDesktopAppKey,
    );
    // A resolver miss can be a startup race, especially for browser MPRIS
    // endpoints. Do not memoize the unresolved list so the next registry
    // notification can replace fallback icons without reopening the popup.
    if (resolvedDesktopAppKeys.some((desktopAppKey) => desktopAppKey === null))
      return null;

    const coloredIcons = this.settings.appIconUseColor;
    const activeBusName = this.popupSurface.player.busName;
    return JSON.stringify([
      coloredIcons,
      activeBusName,
      ...resolvedPlayerRows.map(({ player }, index) => [
        player.busName,
        player.identity,
        player.desktopEntry,
        player.isPinned,
        resolvedDesktopAppKeys[index],
      ]),
    ]);
  }

  syncPlayerSelectorListWidth() {
    const style = this.popupSurface.buildFixedWidthStyle(
      this.popupSurface.getPopupContentWidth(),
    );
    if (this.revealer) this.revealer.style = style;
    if (this.card) this.card.style = style;
  }

  buildPlayerList(resolvedPlayerRows) {
    const playerList = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: MediaShellStyleClasses.POPUP_PLAYER_SELECTOR_LIST,
    });
    const coloredClass = this.settings.appIconUseColor
      ? MediaShellStyleClasses.COLORED_ICON
      : MediaShellStyleClasses.SYMBOLIC_ICON;
    const pinnedPlayer =
      resolvedPlayerRows.find(({ player }) => player.isPinned)?.player ?? null;

    for (const resolvedPlayerRow of resolvedPlayerRows) {
      playerList.add_child(
        this.createPlayerRow(resolvedPlayerRow, pinnedPlayer, coloredClass),
      );
    }
    return playerList;
  }

  createPlayerRow({ player, desktopApp }, pinnedPlayer, coloredClass) {
    const displayName = this.desktopAppResolver.resolveDesktopAppName(
      desktopApp,
      player.identity || _("Unknown app"),
    );
    const displayIcon = this.desktopAppResolver.resolveDesktopAppIcon(desktopApp);
    const isActive = this.popupSurface.isActivePlayer(player);
    const isPinned = player.isPinned;
    const canSelect = pinnedPlayer == null || isPinned;
    const rowItem = new St.BoxLayout({
      styleClass: MediaShellStyleClasses.POPUP_PLAYER_SELECTOR_ROW_ITEM,
      xExpand: true,
    });

    rowItem.add_child(
      this.createPlayerButton({
        player,
        displayName,
        displayIcon,
        coloredClass,
        isActive,
        canSelect,
      }),
    );
    rowItem.add_child(this.createPlayerPinButton(player, isPinned, canSelect));
    return rowItem;
  }

  createPlayerButton({
    player,
    displayName,
    displayIcon,
    coloredClass,
    isActive,
    canSelect,
  }) {
    const playerButton = new St.Button({
      styleClass: styleClassNames(
        NativeStyleClasses.POPUP_MENU_ITEM,
        MediaShellStyleClasses.POPUP_PLAYER_SELECTOR_ROW,
      ),
      opacity: canSelect ? ACTIVE_OPACITY : INACTIVE_OPACITY,
      reactive: canSelect,
      trackHover: canSelect,
      canFocus: canSelect,
      xExpand: true,
    });
    playerButton.set_child(
      this.createPlayerIdentityContent(
        displayName,
        displayIcon,
        coloredClass,
        isActive,
      ),
    );
    playerButton.connect("clicked", () => {
      if (!canSelect) return;
      if (isActive || this.popupSurface.selectPlayer(player)) this.close();
    });
    return playerButton;
  }

  createPlayerIdentityContent(
    displayName,
    displayIcon,
    coloredClass,
    isActive,
  ) {
    const playerContent = new St.BoxLayout({
      styleClass: MediaShellStyleClasses.POPUP_PLAYER_SELECTOR_ROW_BOX,
      xExpand: true,
    });
    playerContent.add_child(
      createIcon(
        {
          gicon: displayIcon,
          styleClass: styleClassNames(
            NativeStyleClasses.POPUP_MENU_ICON,
            MediaShellStyleClasses.POPUP_PLAYER_SELECTOR_ROW_APP_ICON,
            coloredClass,
          ),
          yAlign: Clutter.ActorAlign.CENTER,
        },
        IconNames.MEDIA,
      ),
    );
    playerContent.add_child(
      new St.Label({
        text: displayName,
        styleClass: MediaShellStyleClasses.POPUP_PLAYER_SELECTOR_ROW_LABEL,
        yAlign: Clutter.ActorAlign.CENTER,
        xExpand: true,
      }),
    );
    playerContent.add_child(
      createIcon({
        iconName: "object-select-symbolic",
        styleClass: styleClassNames(
          NativeStyleClasses.POPUP_MENU_ICON,
          MediaShellStyleClasses.POPUP_PLAYER_SELECTOR_ROW_CHECK_ICON,
        ),
        opacity: isActive ? ACTIVE_OPACITY : HIDDEN_OPACITY,
        yAlign: Clutter.ActorAlign.CENTER,
      }),
    );
    return playerContent;
  }

  createPlayerPinButton(player, isPinned, canSelect) {
    const pinButton = new St.Button({
      styleClass: styleClassNames(
        NativeStyleClasses.BUTTON,
        MediaShellStyleClasses.POPUP_PLAYER_SELECTOR_ROW_PIN_BUTTON,
      ),
      opacity: canSelect ? ACTIVE_OPACITY : INACTIVE_OPACITY,
      reactive: canSelect,
      trackHover: canSelect,
      canFocus: canSelect,
      toggleMode: true,
      checked: isPinned,
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
    });
    pinButton.set_child(
      createIcon({
        iconName: "view-pin-symbolic",
        styleClass: styleClassNames(
          NativeStyleClasses.POPUP_MENU_ICON,
          MediaShellStyleClasses.POPUP_PLAYER_SELECTOR_ROW_PIN_ICON,
        ),
      }),
    );
    pinButton.connect("clicked", () => {
      const pinStateChanged = this.popupSurface.togglePlayerPin(player);
      if (!pinStateChanged) pinButton.checked = isPinned;
      this.refreshPlayers();
    });
    return pinButton;
  }

  handleCapturedEvent(event) {
    if (!this.revealer || event.type() !== Clutter.EventType.BUTTON_PRESS)
      return Clutter.EVENT_PROPAGATE;

    const source = event.get_source();
    if (
      actorContainsDescendant(this.revealer, source) ||
      actorContainsDescendant(
        this.playerSelectorButton.interactiveActor,
        source,
      ) ||
      actorContainsEventPoint(this.revealer, event) ||
      actorContainsEventPoint(this.playerSelectorButton.interactiveActor, event)
    ) {
      return Clutter.EVENT_PROPAGATE;
    }
    this.close();
    return Clutter.EVENT_PROPAGATE;
  }

  close(animate = true) {
    if (!this.revealer) return;
    const revealer = this.revealer;
    this.revealer = null;
    this.card = null;
    this.renderSignature = null;
    revealer.remove_all_transitions();
    revealer.clipToAllocation = true;
    if (!animate) {
      revealer.destroy();
      return;
    }
    revealer.height = Math.max(0, revealer.height || revealer.get_height());
    revealer.ease({
      height: 0,
      translation_y: -6,
      duration: POPUP_PLAYER_SELECTOR_ROW_ANIMATION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => revealer.destroy(),
    });
  }

  destroy() {
    this.close(false);
    this.desktopAppResolver = null;
    this.playerSelectorButton = null;
    this.popupSurface = null;
  }
}
