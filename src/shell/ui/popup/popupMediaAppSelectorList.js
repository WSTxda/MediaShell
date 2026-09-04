/**
 * @file popupMediaAppSelectorList.js
 * @module shell.ui.popup.popupMediaAppSelectorList
 *
 * Builds the popup list of available MPRIS media apps.
 *
 * The list owns row creation, active-row styling, pin controls, and reveal
 * animation for the media app selector. It receives MediaApp state and the
 * lifecycle-scoped desktop-app resolver from the controller, then emits user
 * intent without changing MprisPlayerRegistry directly.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { IconNames } from "../../../shared/icons.js";
import {
  ACTIVE_OPACITY,
  HIDDEN_OPACITY,
  INACTIVE_OPACITY,
} from "../../constants/actorState.js";
import {
  POPUP_MEDIA_APP_SELECTOR_REVEAL_DURATION_MS,
  POPUP_MEDIA_APP_SELECTOR_ROW_ANIMATION_MS,
} from "../../constants/popup.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import { createIcon } from "../../utils/icons.js";
import { styleClassNames } from "../../utils/styleClasses.js";

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

function resolveMediaAppRows(mediaApps, desktopAppResolver) {
  return mediaApps.map((mediaApp) => {
    const desktopApp = desktopAppResolver.resolveDesktopApp(
      mediaApp.identity,
      mediaApp.desktopEntry,
      mediaApp.busName,
    );
    return {
      mediaApp,
      desktopApp,
      resolvedDesktopAppKey:
        desktopApp && desktopAppResolver.hasResolvedDesktopAppIcon(desktopApp)
          ? mediaApp.busName
          : null,
    };
  });
}

/**
 * Builds the popup list of available MPRIS media apps.
 */
export default class PopupMediaAppSelectorList {
  constructor(popupContent, mediaAppSelectorButton, desktopAppResolver) {
    this.popupContent = popupContent;
    this.mediaAppSelectorButton = mediaAppSelectorButton;
    this.revealer = null;
    this.card = null;
    this.renderSignature = null;
    this.desktopAppResolver = desktopAppResolver;
  }

  get settings() {
    return this.popupContent.settings;
  }
  get popupItem() {
    return this.popupContent.popupItem;
  }
  get isOpen() {
    return this.revealer != null;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    const mediaApps = this.popupContent.mediaRuntime?.getAvailablePlayers() ?? [];
    if (mediaApps.length <= 1) return;

    this.revealer = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: StyleClasses.POPUP_MEDIA_APP_SELECTOR_REVEALER,
      clipToAllocation: true,
    });
    this.card = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: StyleClasses.POPUP_MEDIA_APP_SELECTOR_CARD,
    });
    this.syncMediaAppSelectorListWidth();
    const resolvedMediaAppRows = resolveMediaAppRows(
      mediaApps,
      this.desktopAppResolver,
    );
    this.card.add_child(this.buildMediaAppList(resolvedMediaAppRows));
    this.renderSignature = this.getRenderSignature(resolvedMediaAppRows);
    this.revealer.add_child(this.card);

    const children = this.popupItem.get_children();
    const selectorButtonIndex = children.indexOf(
      this.mediaAppSelectorButton.actor,
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
      duration: POPUP_MEDIA_APP_SELECTOR_REVEAL_DURATION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => {
        if (this.revealer) this.revealer.clipToAllocation = false;
      },
    });
  }

  refreshMediaApps() {
    if (!this.revealer) return;
    const mediaApps = this.popupContent.mediaRuntime?.getAvailablePlayers() ?? [];
    if (mediaApps.length <= 1) {
      this.close();
      return;
    }
    if (!this.card) return;

    this.syncMediaAppSelectorListWidth();
    const resolvedMediaAppRows = resolveMediaAppRows(
      mediaApps,
      this.desktopAppResolver,
    );
    const renderSignature = this.getRenderSignature(resolvedMediaAppRows);
    if (renderSignature !== null && renderSignature === this.renderSignature)
      return;

    this.card.remove_all_children();
    this.card.add_child(this.buildMediaAppList(resolvedMediaAppRows));
    this.renderSignature = renderSignature;
    const [, naturalHeight] = this.revealer.get_preferred_height(-1);
    this.revealer.height = naturalHeight;
    this.revealer.translation_y = 0;
    this.revealer.clipToAllocation = false;
  }

  getRenderSignature(resolvedMediaAppRows) {
    const resolvedDesktopAppKeys = resolvedMediaAppRows.map(
      ({ resolvedDesktopAppKey }) => resolvedDesktopAppKey,
    );
    // A resolver miss can be a startup race, especially for browser MPRIS
    // endpoints. Do not memoize the unresolved list so the next registry
    // notification can replace fallback icons without reopening the popup.
    if (resolvedDesktopAppKeys.some((desktopAppKey) => desktopAppKey === null))
      return null;

    const coloredIcons = this.settings.mediaAppIconUseColor;
    const activeBusName = this.popupContent.mediaApp.busName;
    return JSON.stringify([
      coloredIcons,
      activeBusName,
      ...resolvedMediaAppRows.map(({ mediaApp }, index) => [
        mediaApp.busName,
        mediaApp.identity,
        mediaApp.desktopEntry,
        mediaApp.isPinned,
        resolvedDesktopAppKeys[index],
      ]),
    ]);
  }

  syncMediaAppSelectorListWidth() {
    const style = this.popupContent.buildFixedWidthStyle(
      this.popupContent.getPopupContentWidth(),
    );
    if (this.revealer) this.revealer.style = style;
    if (this.card) this.card.style = style;
  }

  buildMediaAppList(resolvedMediaAppRows) {
    const mediaAppList = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: StyleClasses.POPUP_MEDIA_APP_SELECTOR_LIST,
    });
    const coloredClass = this.settings.mediaAppIconUseColor
      ? StyleClasses.COLORED_ICON
      : StyleClasses.SYMBOLIC_ICON;
    const pinnedMediaApp =
      resolvedMediaAppRows.find(({ mediaApp }) => mediaApp.isPinned)
        ?.mediaApp ?? null;

    for (const resolvedMediaAppRow of resolvedMediaAppRows) {
      mediaAppList.add_child(
        this.createMediaAppRow(
          resolvedMediaAppRow,
          pinnedMediaApp,
          coloredClass,
        ),
      );
    }
    return mediaAppList;
  }

  createMediaAppRow({ mediaApp, desktopApp }, pinnedMediaApp, coloredClass) {
    const displayName = this.desktopAppResolver.getDesktopAppName(
      desktopApp,
      mediaApp.identity || _("Unknown app"),
    );
    const displayIcon = this.desktopAppResolver.getDesktopAppIcon(desktopApp);
    const isActive = this.popupContent.isActiveMediaApp(mediaApp);
    const isPinned = mediaApp.isPinned;
    const canSelect = pinnedMediaApp == null || isPinned;
    const rowItem = new St.BoxLayout({
      styleClass: StyleClasses.POPUP_MEDIA_APP_SELECTOR_ROW_ITEM,
      xExpand: true,
    });

    rowItem.add_child(
      this.createMediaAppButton({
        mediaApp,
        displayName,
        displayIcon,
        coloredClass,
        isActive,
        canSelect,
      }),
    );
    rowItem.add_child(
      this.createMediaAppPinButton(mediaApp, isPinned, canSelect),
    );
    return rowItem;
  }

  createMediaAppButton({
    mediaApp,
    displayName,
    displayIcon,
    coloredClass,
    isActive,
    canSelect,
  }) {
    const mediaAppButton = new St.Button({
      styleClass: styleClassNames(
        StyleClasses.POPUP_MENU_ITEM,
        StyleClasses.POPUP_MEDIA_APP_SELECTOR_ROW,
      ),
      opacity: canSelect ? ACTIVE_OPACITY : INACTIVE_OPACITY,
      reactive: canSelect,
      trackHover: canSelect,
      canFocus: canSelect,
      xExpand: true,
    });
    mediaAppButton.set_child(
      this.createMediaAppIdentityContent(
        displayName,
        displayIcon,
        coloredClass,
        isActive,
      ),
    );
    mediaAppButton.connect("clicked", () => {
      if (!canSelect) return;
      if (isActive || this.popupContent.selectMediaApp(mediaApp)) this.close();
    });
    return mediaAppButton;
  }

  createMediaAppIdentityContent(
    displayName,
    displayIcon,
    coloredClass,
    isActive,
  ) {
    const mediaAppContent = new St.BoxLayout({
      styleClass: StyleClasses.POPUP_MEDIA_APP_SELECTOR_ROW_BOX,
      xExpand: true,
    });
    mediaAppContent.add_child(
      createIcon(
        {
          gicon: displayIcon,
          styleClass: styleClassNames(
            StyleClasses.POPUP_MENU_ICON,
            StyleClasses.POPUP_MEDIA_APP_SELECTOR_ROW_MEDIA_APP_ICON,
            coloredClass,
          ),
          yAlign: Clutter.ActorAlign.CENTER,
        },
        IconNames.MEDIA,
      ),
    );
    mediaAppContent.add_child(
      new St.Label({
        text: displayName,
        styleClass: StyleClasses.POPUP_MEDIA_APP_SELECTOR_ROW_LABEL,
        yAlign: Clutter.ActorAlign.CENTER,
        xExpand: true,
      }),
    );
    mediaAppContent.add_child(
      createIcon({
        iconName: "object-select-symbolic",
        styleClass: styleClassNames(
          StyleClasses.POPUP_MENU_ICON,
          StyleClasses.POPUP_MEDIA_APP_SELECTOR_ROW_CHECK_ICON,
        ),
        opacity: isActive ? ACTIVE_OPACITY : HIDDEN_OPACITY,
        yAlign: Clutter.ActorAlign.CENTER,
      }),
    );
    return mediaAppContent;
  }

  createMediaAppPinButton(mediaApp, isPinned, canSelect) {
    const pinButton = new St.Button({
      styleClass: styleClassNames(
        StyleClasses.BUTTON,
        StyleClasses.POPUP_MEDIA_APP_SELECTOR_ROW_PIN_BUTTON,
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
          StyleClasses.POPUP_MENU_ICON,
          StyleClasses.POPUP_MEDIA_APP_SELECTOR_ROW_PIN_ICON,
        ),
      }),
    );
    pinButton.connect("clicked", () => {
      const pinStateChanged = this.popupContent.toggleMediaAppPin(mediaApp);
      if (!pinStateChanged) pinButton.checked = isPinned;
      this.refreshMediaApps();
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
        this.mediaAppSelectorButton.interactiveActor,
        source,
      ) ||
      actorContainsEventPoint(this.revealer, event) ||
      actorContainsEventPoint(
        this.mediaAppSelectorButton.interactiveActor,
        event,
      )
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
      duration: POPUP_MEDIA_APP_SELECTOR_ROW_ANIMATION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => revealer.destroy(),
    });
  }

  destroy() {
    this.close(false);
    this.desktopAppResolver = null;
    this.mediaAppSelectorButton = null;
    this.popupContent = null;
  }
}
