/**
 * @file PopupAppSelectorList.js
 * @module shell.ui.popup.PopupAppSelectorList
 *
 * Builds the popup list of available MPRIS media apps.
 *
 * The list owns row creation, active-row styling, pin controls, and reveal
 * animation for the app selector. It receives app data from the controller and
 * emits user intent without changing MediaAppRegistry directly.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { IconNames } from "../../../shared/constants/icons.js";
import MediaAppResolver from "../../services/MediaAppResolver.js";
import {
  ACTIVE_OPACITY,
  HIDDEN_OPACITY,
  INACTIVE_OPACITY,
} from "../../constants/actorState.js";
import {
  POPUP_APP_SELECTOR_REVEAL_DURATION_MS,
  POPUP_APP_SELECTOR_ROW_ANIMATION_MS,
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

function resolveMediaAppRows(mediaApps, mediaAppResolver) {
  return mediaApps.map((mediaApp) => {
    const app = mediaAppResolver.resolveMediaApp(
      mediaApp.identity,
      mediaApp.desktopEntry,
      mediaApp.busName,
    );
    return {
      mediaApp,
      app,
      resolvedAppKey:
        app && mediaAppResolver.hasResolvedMediaAppIcon(app)
          ? mediaApp.busName
          : null,
    };
  });
}

/**
 * Builds the popup list of available MPRIS media apps.
 */
export default class PopupAppSelectorList {
  constructor(popupContent, appSelectorButton) {
    this.popupContent = popupContent;
    this.appSelectorButton = appSelectorButton;
    this.revealer = null;
    this.card = null;
    this.renderSignature = null;
    this.mediaAppResolver = MediaAppResolver.getInstance();
  }

  get extensionController() {
    return this.popupContent.extensionController;
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
    const mediaApps = this.extensionController.getAvailableMediaApps();
    if (mediaApps.length <= 1) return;

    this.revealer = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: StyleClasses.POPUP_APP_SELECTOR_REVEALER,
      clipToAllocation: true,
    });
    this.card = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: StyleClasses.POPUP_APP_SELECTOR_CARD,
    });
    this.syncAppSelectorListWidth();
    const resolvedMediaAppRows = resolveMediaAppRows(
      mediaApps,
      this.mediaAppResolver,
    );
    this.card.add_child(this.buildMediaAppList(resolvedMediaAppRows));
    this.renderSignature = this.getRenderSignature(resolvedMediaAppRows);
    this.revealer.add_child(this.card);

    const children = this.popupItem.get_children();
    const appsIndex = children.indexOf(this.appSelectorButton.actor);
    this.popupItem.insert_child_at_index(
      this.revealer,
      appsIndex < 0 ? 0 : appsIndex + 1,
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
      duration: POPUP_APP_SELECTOR_REVEAL_DURATION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => {
        if (this.revealer) this.revealer.clipToAllocation = false;
      },
    });
  }

  refreshMediaApps() {
    if (!this.revealer) return;
    const mediaApps = this.extensionController.getAvailableMediaApps();
    if (mediaApps.length <= 1) {
      this.close();
      return;
    }
    if (!this.card) return;

    this.syncAppSelectorListWidth();
    const resolvedMediaAppRows = resolveMediaAppRows(
      mediaApps,
      this.mediaAppResolver,
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
    const resolvedAppKeys = resolvedMediaAppRows.map(
      ({ resolvedAppKey }) => resolvedAppKey,
    );
    // A resolver miss can be a startup race, especially for browser MPRIS
    // endpoints. Do not memoize the unresolved list so the next registry
    // notification can replace fallback icons without reopening the popup.
    if (resolvedAppKeys.some((appKey) => appKey === null)) return null;

    const coloredIcons = this.extensionController.popupAppIconUseColor;
    const activeBusName = this.popupContent.mediaApp.busName;
    return JSON.stringify([
      coloredIcons,
      activeBusName,
      ...resolvedMediaAppRows.map(({ mediaApp }, index) => [
        mediaApp.busName,
        mediaApp.identity,
        mediaApp.desktopEntry,
        mediaApp.isPinned,
        resolvedAppKeys[index],
      ]),
    ]);
  }

  syncAppSelectorListWidth() {
    const style = this.popupContent.buildFixedWidthStyle(
      this.popupContent.getPopupContentWidth(),
    );
    if (this.revealer) this.revealer.style = style;
    if (this.card) this.card.style = style;
  }

  buildMediaAppList(resolvedMediaAppRows) {
    const appList = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: StyleClasses.POPUP_APP_SELECTOR_LIST,
    });
    const coloredClass = this.extensionController.popupAppIconUseColor
      ? StyleClasses.COLORED_ICON
      : StyleClasses.SYMBOLIC_ICON;
    const pinnedMediaApp =
      resolvedMediaAppRows.find(({ mediaApp }) => mediaApp.isPinned)
        ?.mediaApp ?? null;

    for (const { mediaApp, app } of resolvedMediaAppRows) {
      const appName = this.mediaAppResolver.getMediaAppName(
        app,
        mediaApp.identity || _("Unknown app"),
      );
      const appIcon = this.mediaAppResolver.getMediaAppIcon(app);
      const isActive = this.popupContent.isActiveMediaApp(mediaApp);
      const isPinned = mediaApp.isPinned;
      const canSelect = pinnedMediaApp == null || isPinned;

      const rowItem = new St.BoxLayout({
        styleClass: StyleClasses.POPUP_APP_SELECTOR_ROW_ITEM,
        xExpand: true,
      });
      const appButton = new St.Button({
        styleClass: styleClassNames(
          StyleClasses.POPUP_MENU_ITEM,
          StyleClasses.POPUP_APP_SELECTOR_ROW,
        ),
        opacity: canSelect ? ACTIVE_OPACITY : INACTIVE_OPACITY,
        reactive: canSelect,
        trackHover: canSelect,
        canFocus: canSelect,
        xExpand: true,
      });
      const appContent = new St.BoxLayout({
        styleClass: StyleClasses.POPUP_APP_SELECTOR_ROW_BOX,
        xExpand: true,
      });
      appContent.add_child(
        createIcon(
          {
            gicon: appIcon,
            styleClass: styleClassNames(
              StyleClasses.POPUP_MENU_ICON,
              StyleClasses.POPUP_APP_SELECTOR_ROW_APP_ICON,
              coloredClass,
            ),
            yAlign: Clutter.ActorAlign.CENTER,
          },
          IconNames.MEDIA,
        ),
      );
      appContent.add_child(
        new St.Label({
          text: appName,
          styleClass: StyleClasses.POPUP_APP_SELECTOR_ROW_LABEL,
          yAlign: Clutter.ActorAlign.CENTER,
          xExpand: true,
        }),
      );
      appContent.add_child(
        createIcon({
          iconName: "object-select-symbolic",
          styleClass: styleClassNames(
            StyleClasses.POPUP_MENU_ICON,
            StyleClasses.POPUP_APP_SELECTOR_ROW_CHECK_ICON,
          ),
          opacity: isActive ? ACTIVE_OPACITY : HIDDEN_OPACITY,
          yAlign: Clutter.ActorAlign.CENTER,
        }),
      );

      const pinButton = new St.Button({
        styleClass: styleClassNames(
          StyleClasses.BUTTON,
          StyleClasses.POPUP_APP_SELECTOR_ROW_PIN_BUTTON,
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
            StyleClasses.POPUP_APP_SELECTOR_ROW_PIN_ICON,
          ),
        }),
      );
      pinButton.connect("clicked", () => {
        const pinStateChanged = this.popupContent.toggleMediaAppPin(mediaApp);
        if (!pinStateChanged) pinButton.checked = isPinned;
        this.refreshMediaApps();
      });

      appButton.set_child(appContent);
      appButton.connect("clicked", () => {
        if (!canSelect) return;
        if (isActive || this.popupContent.selectMediaApp(mediaApp))
          this.close();
      });
      rowItem.add_child(appButton);
      rowItem.add_child(pinButton);
      appList.add_child(rowItem);
    }
    return appList;
  }

  handleCapturedEvent(event) {
    if (!this.revealer || event.type() !== Clutter.EventType.BUTTON_PRESS)
      return Clutter.EVENT_PROPAGATE;

    const source = event.get_source();
    if (
      actorContainsDescendant(this.revealer, source) ||
      actorContainsDescendant(
        this.appSelectorButton.interactiveActor,
        source,
      ) ||
      actorContainsEventPoint(this.revealer, event) ||
      actorContainsEventPoint(this.appSelectorButton.interactiveActor, event)
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
      duration: POPUP_APP_SELECTOR_ROW_ANIMATION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => revealer.destroy(),
    });
  }

  destroy() {
    this.close(false);
    this.appSelectorButton = null;
    this.popupContent = null;
  }
}
