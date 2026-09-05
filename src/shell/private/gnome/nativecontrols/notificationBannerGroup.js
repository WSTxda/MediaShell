/**
 * @file notificationBannerGroup.js
 * @module shell.private.gnome.nativecontrols.notificationBannerGroup
 *
 * Native-style notification banner group used only by the private Enhance
 * adapter.
 * Its geometry intentionally mirrors GNOME Shell internals and therefore stays
 * quarantined from reusable MediaShell UI components.
 */

import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { installPrimaryClickAction } from "../../../ui/input/pointerActions.js";
import { prefersReducedMotion } from "../../../ui/accessibility/reducedMotion.js";

const GROUP_GTYPE_NAME = "MediaShellEnhanceNotificationBannerGroup";
const GROUP_LAYOUT_GTYPE_NAME = "MediaShellEnhanceNotificationBannerGroupLayout";

// Matches GNOME Shell's private notification-group stack geometry.
const GROUP_EXPANSION_TIME = 200;
const MAX_VISIBLE_STACKED_BANNERS = 3;
const ADDITIONAL_BOTTOM_MARGIN_EXPANDED_GROUP = 15;
const WIDTH_OFFSET_STACKED = 6;
const HEIGHT_OFFSET_STACKED = 10;
const HEIGHT_OFFSET_REDUCTION_STACKED = 1.4;

const EnhanceNotificationBannerGroupLayout = GObject.registerClass(
  {
    GTypeName: GROUP_LAYOUT_GTYPE_NAME,
    Properties: {
      expansion: GObject.ParamSpec.double(
        "expansion",
        null,
        null,
        GObject.ParamFlags.READWRITE,
        0,
        1,
        0,
      ),
    },
  },
  class EnhanceNotificationBannerGroupLayout extends Clutter.LayoutManager {
    constructor(cover, header) {
      super();
      this.cover = cover;
      this.header = header;
      this._expansion = 0;
    }

    get expansion() {
      return this._expansion;
    }

    set expansion(value) {
      const next = Math.min(1, Math.max(0, value));
      if (next === this._expansion) return;
      this._expansion = next;
      this.notify("expansion");
      this.layout_changed();
    }

    getStack(container) {
      return container
        .get_children()
        .filter(
          (child) =>
            child !== this.cover && child !== this.header && child.visible,
        );
    }

    getExpandedHeight(container, forWidth) {
      let minimum = 0;
      let natural = 0;

      for (const child of container.get_children()) {
        if (child === this.cover) continue;
        const [childMinimum, childNatural] =
          child.get_preferred_height(forWidth);
        minimum += childMinimum;
        natural += childNatural;
      }

      return [
        minimum + ADDITIONAL_BOTTOM_MARGIN_EXPANDED_GROUP,
        natural + ADDITIONAL_BOTTOM_MARGIN_EXPANDED_GROUP,
      ];
    }

    vfunc_get_preferred_width(container, forHeight) {
      let minimum = 0;
      let natural = 0;

      for (const child of container.get_children()) {
        if (child === this.cover || !child.visible) continue;
        const [childMinimum, childNatural] =
          child.get_preferred_width(forHeight);
        minimum = Math.max(minimum, childMinimum);
        natural = Math.max(natural, childNatural);
      }

      return [minimum, natural];
    }

    vfunc_get_preferred_height(container, forWidth) {
      let offset = HEIGHT_OFFSET_STACKED;
      let minimum = 0;
      let natural = 0;
      let remaining = MAX_VISIBLE_STACKED_BANNERS;

      for (const child of this.getStack(container)) {
        if (minimum === 0 || natural === 0) {
          [minimum, natural] = child.get_preferred_height(forWidth);
        } else {
          minimum += offset;
          natural += offset;
          offset /= HEIGHT_OFFSET_REDUCTION_STACKED;
        }

        if (--remaining === 0) break;
      }

      const [expandedMinimum, expandedNatural] = this.getExpandedHeight(
        container,
        forWidth,
      );
      return [
        minimum + this._expansion * (expandedMinimum - minimum),
        natural + this._expansion * (expandedNatural - natural),
      ];
    }

    vfunc_allocate(container, allocation) {
      const box = allocation;
      const childWidth = box.x2 - box.x1;
      const fullY2 = box.y2;

      if (this.cover.visible) this.cover.allocate(box);

      if (this.header.visible) {
        const [minimum] = this.header.get_preferred_height(childWidth);
        box.y2 = box.y1 + minimum;
        this.header.allocate(box);
        box.y1 += this._expansion * (box.y2 - box.y1);
      }

      const [top, ...rest] = this.getStack(container);
      if (!top) return;

      const [topMinimum] = top.get_preferred_height(childWidth);
      box.y2 = box.y1 + topMinimum;
      top.allocate(box);

      let heightOffset = HEIGHT_OFFSET_STACKED;
      for (const child of rest) {
        const [minimum] = child.get_preferred_height(childWidth);
        const widthOffset = (1 - this._expansion) * WIDTH_OFFSET_STACKED;
        box.x1 += widthOffset;
        box.x2 -= widthOffset;
        box.y2 += heightOffset + this._expansion * (minimum - heightOffset);

        if (box.y2 > fullY2) box.y2 = fullY2;
        else heightOffset /= HEIGHT_OFFSET_REDUCTION_STACKED;

        box.y1 = box.y2 - minimum;
        child.allocate(box);
      }
    }
  },
);

class EnhanceNotificationBannerGroup extends St.Widget {
  constructor() {
    const cover = new St.Widget({ name: "cover", reactive: true });
    const header = new St.BoxLayout({
      styleClass: "message-group-header",
      xExpand: true,
      visible: false,
    });
    super({
      styleClass: "message-notification-group",
      xExpand: true,
      reactive: true,
      layoutManager: new EnhanceNotificationBannerGroupLayout(cover, header),
    });

    this.cover = cover;
    this.headerBox = header;
    this._banners = [];
    this._expanded = false;
    this._focusChild = null;

    this.headerBox.add_child(
      new St.Label({
        styleClass: "message-group-title",
        text: _("Media"),
        yAlign: Clutter.ActorAlign.CENTER,
      }),
    );

    this.collapseButton = new St.Button({
      styleClass: "message-collapse-button",
      iconName: "group-collapse-symbolic",
      xAlign: Clutter.ActorAlign.END,
      yAlign: Clutter.ActorAlign.CENTER,
      xExpand: true,
      yExpand: true,
    });
    this.collapseButton.set_accessible_name(_("Media"));
    this.collapseButton.connect("clicked", () =>
      this.emit("expand-toggle-requested"),
    );
    this.headerBox.add_child(this.collapseButton);

    this.disconnectClickAction = installPrimaryClickAction(this, () =>
      this.emit("expand-toggle-requested"),
    );

    this.add_child(this.headerBox);
    this.add_child(this.cover);
    this.syncStackState();
  }

  get expanded() {
    return this._expanded || this._banners.length === 1;
  }

  get banners() {
    return [...this._banners];
  }

  get expandedHeight() {
    return this.layoutManager.getExpandedHeight(this, -1)[0];
  }

  canClose() {
    return false;
  }

  addBanner(banner) {
    if (!banner || this._banners.includes(banner)) return false;

    this._banners.unshift(banner);
    banner.connectObject(
      "key-focus-in",
      () => {
        this._focusChild = banner;
        this.emit("banner-focused", banner);
      },
      "clicked",
      () => {
        if (this.expanded) return;
        GObject.signal_stop_emission_by_name(banner, "clicked");
        this.emit("expand-toggle-requested");
      },
      this,
    );

    this.insert_child_at_index(banner, 0);
    this.ensureCoverPosition();
    this.syncStackState();
    return true;
  }

  removeBanner(banner) {
    const index = this._banners.indexOf(banner);
    if (index < 0) return false;

    this._banners.splice(index, 1);
    if (this._focusChild === banner) this._focusChild = null;
    banner.disconnectObject(this);
    banner.destroy();
    this.ensureCoverPosition();
    this.syncStackState();

    if (this._expanded && this._banners.length <= 1)
      this.emit("expand-toggle-requested");
    return true;
  }

  moveToTop(banner) {
    const index = this._banners.indexOf(banner);
    if (index <= 0) return;

    this._banners.splice(index, 1);
    this._banners.unshift(banner);
    this.set_child_at_index(banner, 0);
    this.ensureCoverPosition();
    this.syncStackState();
  }

  async expand() {
    if (this._expanded) return;

    this.headerBox.show();
    this._expanded = true;
    this.syncStackState();
    this.notify("expanded");
    this.cover.hide();

    await this.ease_property_async("@layout.expansion", 1, {
      progress_mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      duration: prefersReducedMotion() ? 0 : GROUP_EXPANSION_TIME,
    }).catch(() => {});
  }

  async collapse() {
    if (!this._expanded) return;

    if (this._focusChild?.has_key_focus()) this._banners[0]?.grab_key_focus();

    this._expanded = false;
    this.notify("expanded");
    this.syncStackState();

    await this.ease_property_async("@layout.expansion", 0, {
      progress_mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      duration: prefersReducedMotion() ? 0 : GROUP_EXPANSION_TIME,
    }).catch(() => {});

    this.headerBox.hide();
    this.syncStackState();
  }

  ensureCoverPosition() {
    if (this.get_n_children() > 2) this.set_child_at_index(this.cover, 1);
  }

  syncStackState() {
    this.cover.visible = !this._expanded && this._banners.length > 1;

    for (const banner of this._banners) {
      banner.remove_style_pseudo_class("second-in-stack");
      banner.remove_style_pseudo_class("lower-in-stack");
    }

    if (this.expanded) return;

    const [, second, ...lower] = this._banners;
    second?.add_style_pseudo_class("second-in-stack");
    for (const banner of lower)
      banner.add_style_pseudo_class("lower-in-stack");
  }

  vfunc_paint(paintContext) {
    for (const child of this.get_children().reverse())
      child.paint(paintContext);
  }

  vfunc_pick(pickContext) {
    for (const child of this.get_children().reverse()) child.pick(pickContext);
  }

  vfunc_get_focus_chain() {
    if (this._expanded) return [...this._banners, this.collapseButton];
    const top = this._banners[0];
    return top ? [top] : [];
  }

  destroy() {
    this.disconnectClickAction();
    this.disconnectClickAction = null;
    super.destroy();
  }
}

export default GObject.registerClass(
  {
    GTypeName: GROUP_GTYPE_NAME,
    Properties: {
      expanded: GObject.ParamSpec.boolean(
        "expanded",
        null,
        null,
        GObject.ParamFlags.READABLE,
        false,
      ),
    },
    Signals: {
      "expand-toggle-requested": {},
      "banner-focused": { param_types: [Clutter.Actor.$gtype] },
    },
  },
  EnhanceNotificationBannerGroup,
);
