/**
 * @file TopBarElementOrderGroup.js
 * @module prefs.widgets.TopBarElementOrderGroup
 *
 * Custom preferences group for ordering top-bar elements with drag and drop.
 *
 * The widget owns the reorderable list rows and serializes their element IDs
 * back to the top-bar order setting. Row snapshots and drop targets stay local
 * to the widget, leaving TopBarStructureController responsible only for the
 * resulting setting value.
 */

import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import GObject from "gi://GObject";
import Graphene from "gi://Graphene";
import Gtk from "gi://Gtk";

/**
 * Custom preferences group for ordering top-bar elements with drag and drop.
 */
class TopBarElementOrderGroup extends Adw.PreferencesGroup {
    elementOrder = [];

    constructor(params = {}) {
        super(params);
        this.dragControllersInitialized = false;
        this.listBox = this._lb_top_bar_element_order;
        this.appIconRow = this._row_app_icon;
        this.trackInformationRow = this._row_track_information;
        this.visualizerRow = this._row_visualizer;
        this.playbackControlsRow = this._row_playback_controls;
        this.appIconRow.elementKey = "APP_ICON";
        this.trackInformationRow.elementKey = "TRACK_INFORMATION";
        this.visualizerRow.elementKey = "VISUALIZER";
        this.playbackControlsRow.elementKey = "PLAYBACK_CONTROLS";

        const dropTarget = Gtk.DropTarget.new(GObject.TYPE_UINT, Gdk.DragAction.MOVE);
        dropTarget.connect("drop", (_target, sourceIndex, _x, y) => {
            const targetRow = this.listBox.get_row_at_y(y);
            const index = Number(sourceIndex);
            if (targetRow == null || !Number.isInteger(index) || index < 0 || index >= this.elementOrder.length)
                return false;

            const sourceValue = this.elementOrder[index];
            const targetIndex = targetRow.get_index();
            this.elementOrder.splice(targetIndex > index ? targetIndex + 1 : targetIndex, 0, sourceValue);
            this.elementOrder.splice(index > targetIndex ? index + 1 : index, 1);
            this.notify("element-order");
            this.listBox.drag_unhighlight_row();
            this.listBox.invalidate_sort();
            return true;
        });
        this.listBox.add_controller(dropTarget);
        this.listBox.set_sort_func((firstRow, secondRow) => {
            return this.elementOrder.indexOf(firstRow.elementKey) - this.elementOrder.indexOf(secondRow.elementKey);
        });
    }

    setElementOrder(elementOrder) {
        this.elementOrder = [...elementOrder];
        if (!this.dragControllersInitialized) {
            this.addDragControllers(this.appIconRow);
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
            source.set_icon(this.snapshotRow(source.widget), dragX, dragY);
        });
        dropController.connect("enter", (controller) => {
            this.listBox.drag_highlight_row(controller.widget);
        });
        dropController.connect("leave", () => this.listBox.drag_unhighlight_row());
        row.add_controller(dragSource);
        row.add_controller(dropController);
    }

    snapshotRow(row) {
        const width = row.get_allocated_width();
        const height = row.get_allocated_height();
        const paintable = new Gtk.WidgetPaintable({ widget: row });
        const snapshot = new Gtk.Snapshot();
        paintable.snapshot(snapshot, width, height);
        // GSK texture rendering expects explicit Graphene.Rect bounds for the row snapshot
        const rect = new Graphene.Rect();
        rect.init(0, 0, width, height);
        return row.get_native().get_renderer().render_texture(snapshot.to_node(), rect);
    }
}

export default GObject.registerClass(
    {
        GTypeName: "MediaShellTopBarElementOrderGroup",
        Template: "resource:///org/gnome/shell/extensions/mediashell/ui/top-bar-element-order.ui",
        InternalChildren: [
            "lb-top-bar-element-order",
            "row-app-icon",
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
