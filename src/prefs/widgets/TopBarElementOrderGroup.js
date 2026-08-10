/**
 * @file TopBarElementOrderGroup.js
 * @module prefs.widgets.TopBarElementOrderGroup
 *
 * Custom preferences group for ordering top bar elements with drag and drop.
 *
 * The widget owns the reorderable list rows and serializes their element IDs
 * back to the top bar order setting. Row snapshots and drop targets stay local
 * to the widget, leaving TopBarLayoutController responsible only for the
 * resulting setting value.
 */

import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";

import { GTypeNames } from "../../shared/constants/gtypes.js";
import { ResourceUris } from "../../shared/constants/resources.js";
import { moveArrayItem } from "../../shared/utils/collections.js";
import { createDragTexture } from "../utils/dragAndDrop.js";

/**
 * Custom preferences group for ordering top bar elements with drag and drop.
 */
class TopBarElementOrderGroup extends Adw.PreferencesGroup {
  elementOrder = [];

  constructor(params = {}) {
    super(params);
    this.dragControllersInitialized = false;
    this.listBox = this._lb_top_bar_element_order;
    this.mediaAppIconRow = this._row_media_app_icon;
    this.trackInformationRow = this._row_track_information;
    this.visualizerRow = this._row_visualizer;
    this.playbackControlsRow = this._row_playback_controls;
    this.mediaAppIconRow.elementKey = "MEDIA_APP_ICON";
    this.trackInformationRow.elementKey = "TRACK_INFORMATION";
    this.visualizerRow.elementKey = "VISUALIZER";
    this.playbackControlsRow.elementKey = "PLAYBACK_CONTROLS";

    const dropTarget = Gtk.DropTarget.new(
      GObject.TYPE_UINT,
      Gdk.DragAction.MOVE,
    );
    dropTarget.connect("drop", (_target, sourceIndex, _x, y) => {
      const targetRow = this.listBox.get_row_at_y(y);
      const index = Number(sourceIndex);
      if (
        targetRow == null ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= this.elementOrder.length
      )
        return false;

      const targetIndex = targetRow.get_index();
      if (!moveArrayItem(this.elementOrder, index, targetIndex)) return false;
      this.notify("element-order");
      this.listBox.drag_unhighlight_row();
      this.listBox.invalidate_sort();
      return true;
    });
    this.listBox.add_controller(dropTarget);
    this.listBox.set_sort_func((firstRow, secondRow) => {
      return (
        this.elementOrder.indexOf(firstRow.elementKey) -
        this.elementOrder.indexOf(secondRow.elementKey)
      );
    });
  }

  setElementOrder(elementOrder) {
    this.elementOrder = [...elementOrder];
    if (!this.dragControllersInitialized) {
      this.addDragControllers(this.mediaAppIconRow);
      this.addDragControllers(this.trackInformationRow);
      this.addDragControllers(this.visualizerRow);
      this.addDragControllers(this.playbackControlsRow);
      this.dragControllersInitialized = true;
    }
    this.listBox.invalidate_sort();
  }

  addDragControllers(row) {
    let dragX = 0;
    let dragY = 0;
    const dragSource = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE });
    const dropController = new Gtk.DropControllerMotion();

    dragSource.connect("prepare", (source, x, y) => {
      dragX = x;
      dragY = y;
      const value = new GObject.Value();
      value.init(GObject.TYPE_UINT);
      value.set_uint(source.widget.get_index());
      return Gdk.ContentProvider.new_for_value(value);
    });
    dragSource.connect("drag-begin", (source) => {
      source.set_icon(createDragTexture(source.widget), dragX, dragY);
    });
    dropController.connect("enter", (controller) => {
      this.listBox.drag_highlight_row(controller.widget);
    });
    dropController.connect("leave", () => this.listBox.drag_unhighlight_row());
    row.add_controller(dragSource);
    row.add_controller(dropController);
  }
}

export default GObject.registerClass(
  {
    GTypeName: GTypeNames.TOP_BAR_ELEMENT_ORDER_GROUP,
    Template: ResourceUris.TOP_BAR_ELEMENT_ORDER_UI,
    InternalChildren: [
      "lb-top-bar-element-order",
      "row-media-app-icon",
      "row-track-information",
      "row-visualizer",
      "row-playback-controls",
    ],
    Properties: {
      "element-order": GObject.ParamSpec.jsobject(
        "element-order",
        "top bar element order",
        "top bar element order",
        GObject.ParamFlags.READABLE,
      ),
    },
  },
  TopBarElementOrderGroup,
);
