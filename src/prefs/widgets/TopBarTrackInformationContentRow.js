// Implements drag-and-drop ordering and custom fields for top bar track information.
import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import GObject from "gi://GObject";
import Graphene from "gi://Graphene";
import Gtk from "gi://Gtk";
import { gettext as _ } from "../PreferencesTranslations.js";

import { TrackInformationFields } from "../../shared/enums/MediaShellEnums.js";

function createTranslatedFields() {
    return Object.freeze({
        ARTIST: _("Artist"),
        TITLE: _("Title"),
        ALBUM: _("Album"),
        DISC_NUMBER: _("Disc"),
        TRACK_NUMBER: _("Track"),
    });
}

class TopBarTrackInformationContentRow extends Adw.ExpanderRow {
    contentItems = [];

    constructor(params = {}) {
        super(params);
        this.renderedRows = [];
        this.translatedFields = createTranslatedFields();
        this.fieldKeys = Object.keys(TrackInformationFields);
        this.fieldModel = new Gtk.StringList({
            strings: this.fieldKeys.map((key) => this.translatedFields[key]),
        });

        this._btn_add_field.connect("clicked", () => this.addContentItem("ALBUM"));
        this._btn_add_text.connect("clicked", () => this.addContentItem("•"));
    }

    addContentItem(contentItem) {
        this.contentItems.push(contentItem);
        this.notify("content-items");
        this.render();
    }

    setContentItems(contentItems) {
        this.contentItems = [...contentItems];
        this.render();
    }

    render() {
        for (const row of this.renderedRows) this.remove(row);
        this.renderedRows.length = 0;

        if (this.contentItems.length === 0) {
            this.addRenderedRow(new Adw.ActionRow({ title: _("No track information fields added"), sensitive: false }));
            return;
        }

        for (let index = 0; index < this.contentItems.length; index++) {
            const contentItem = this.contentItems[index];
            let row;

            if (Object.hasOwn(TrackInformationFields, contentItem)) {
                row = new Adw.ComboRow({
                    title: this.translatedFields[contentItem],
                    model: this.fieldModel,
                    selected: this.fieldKeys.indexOf(contentItem),
                });
                this.connectFieldSelectionChange(row);
            } else {
                row = new Adw.EntryRow({
                    title: _("Custom text"),
                    text: contentItem,
                });
                this.connectCustomTextChange(row);
            }

            this.configureRow(row, index);
            this.addRenderedRow(row);
        }
    }

    addRenderedRow(row) {
        this.renderedRows.push(row);
        this.add_row(row);
    }

    configureRow(row, index) {
        row.contentIndex = index;
        row.add_prefix(new Gtk.Image({ icon_name: "list-drag-handle-symbolic" }));

        const removeButton = new Gtk.Button({
            icon_name: "user-trash-symbolic",
            margin_top: 10,
            margin_bottom: 10,
            tooltip_text: _("Remove"),
        });
        removeButton.add_css_class("flat");
        removeButton.add_css_class("circular");
        removeButton.connect("clicked", () => {
            this.contentItems.splice(row.contentIndex, 1);
            this.notify("content-items");
            this.render();
        });
        row.add_suffix(removeButton);

        const value = new GObject.Value();
        value.init(GObject.TYPE_UINT);
        value.set_uint(index);
        const dragSource = new Gtk.DragSource({
            actions: Gdk.DragAction.MOVE,
            content: Gdk.ContentProvider.new_for_value(value),
        });
        dragSource.connect("prepare", (source, x, y) => {
            source.set_icon(this.snapshotRow(source.widget), x, y);
            return source.content;
        });
        row.add_controller(dragSource);

        const dropTarget = Gtk.DropTarget.new(GObject.TYPE_UINT, Gdk.DragAction.MOVE);
        dropTarget.connect("drop", (_target, sourceIndex) => this.moveContentItem(Number(sourceIndex), row.contentIndex));
        row.add_controller(dropTarget);
    }

    moveContentItem(sourceIndex, targetIndex) {
        if (
            !Number.isInteger(sourceIndex) ||
            !Number.isInteger(targetIndex) ||
            sourceIndex < 0 ||
            targetIndex < 0 ||
            sourceIndex >= this.contentItems.length ||
            targetIndex >= this.contentItems.length ||
            sourceIndex === targetIndex
        )
            return false;

        const [sourceValue] = this.contentItems.splice(sourceIndex, 1);
        this.contentItems.splice(targetIndex, 0, sourceValue);
        this.notify("content-items");
        this.render();
        return true;
    }

    connectFieldSelectionChange(row) {
        row.connect("notify::selected", () => {
            const fieldKey = this.fieldKeys[row.selected];
            if (!fieldKey || this.contentItems[row.contentIndex] === fieldKey) return;
            this.contentItems.splice(row.contentIndex, 1, fieldKey);
            this.notify("content-items");
            this.render();
        });
    }

    connectCustomTextChange(row) {
        row.connect("notify::text", () => {
            this.contentItems.splice(row.contentIndex, 1, row.text);
            this.notify("content-items");
        });
    }

    snapshotRow(row) {
        const width = row.get_allocated_width();
        const height = row.get_allocated_height();
        const paintable = new Gtk.WidgetPaintable({ widget: row });
        const snapshot = new Gtk.Snapshot();
        paintable.snapshot(snapshot, width, height);
        const rect = new Graphene.Rect();
        rect.init(0, 0, width, height);
        return row.get_native().get_renderer().render_texture(snapshot.to_node(), rect);
    }
}

export default GObject.registerClass(
    {
        GTypeName: "TopBarTrackInformationContentRow",
        Template: "resource:///org/gnome/shell/extensions/mediashell/ui/top-bar-track-information-content-row.ui",
        InternalChildren: ["btn-add-field", "btn-add-text"],
        Properties: {
            "content-items": GObject.ParamSpec.jsobject(
                "content-items",
                "Content items",
                "Top bar track information content items",
                GObject.ParamFlags.READABLE,
            ),
        },
    },
    TopBarTrackInformationContentRow,
);
