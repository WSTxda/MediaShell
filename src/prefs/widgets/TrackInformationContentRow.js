/**
 * @file TrackInformationContentRow.js
 * @module prefs.widgets.TrackInformationContentRow
 *
 * Custom row for choosing ordered track-information fields and text fragments.
 *
 * Popup and top bar preferences share this editor so field selection, custom
 * text, drag/drop ordering, and metadata availability information stay aligned
 * while each runtime surface keeps its own rendering code.
 */

import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import { gettext as _ } from "../translations.js";

import { GTypeNames } from "../../shared/constants/gtypes.js";
import { ResourceUris } from "../../shared/constants/resources.js";
import { TrackInformationFields } from "../../shared/enums/trackInformation.js";
import { moveArrayItem } from "../../shared/utils/collections.js";
import { createDragTexture } from "../utils/dragAndDrop.js";

function createTranslatedFields() {
  return Object.freeze({
    TITLE: _("Title"),
    ARTIST: _("Artist"),
    ALBUM: _("Album"),
    ALBUM_ARTIST: _("Album artist"),
    GENRE: _("Genre"),
    COMPOSER: _("Composer"),
    CONTENT_CREATED: _("Year"),
    DISC_NUMBER: _("Disc"),
    TRACK_NUMBER: _("Track"),
  });
}

/**
 * Custom row for choosing ordered track-information fields and text fragments.
 */
class TrackInformationContentRow extends Adw.ExpanderRow {
  contentItems = [];
  customTextDefault = "•";

  constructor(params = {}) {
    super(params);
    this.renderedRows = [];
    this.translatedFields = createTranslatedFields();
    this.fieldKeys = Object.keys(TrackInformationFields);
    this.fieldModel = new Gtk.StringList({
      strings: this.fieldKeys.map((key) => this.translatedFields[key]),
    });

    this._btn_add_field.connect("clicked", () => this.addContentItem("ALBUM"));
    this._btn_add_text.connect("clicked", () =>
      this.addContentItem(this.customTextDefault),
    );
  }

  setCustomTextDefault(customTextDefault) {
    this.customTextDefault = customTextDefault || "•";
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
      this.addRenderedRow(
        new Adw.ActionRow({
          title: _("No track information fields added"),
          sensitive: false,
        }),
      );
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

    const removeLabel = _("Remove");
    const removeButton = new Gtk.Button({
      icon_name: "user-trash-symbolic",
      tooltip_text: removeLabel,
      has_frame: false,
      valign: Gtk.Align.CENTER,
    });
    removeButton.update_property([Gtk.AccessibleProperty.LABEL], [removeLabel]);
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
      source.set_icon(createDragTexture(source.widget), x, y);
      return source.content;
    });
    row.add_controller(dragSource);

    const dropTarget = Gtk.DropTarget.new(
      GObject.TYPE_UINT,
      Gdk.DragAction.MOVE,
    );
    dropTarget.connect("drop", (_target, sourceIndex) =>
      this.moveContentItem(Number(sourceIndex), row.contentIndex),
    );
    row.add_controller(dropTarget);
  }

  moveContentItem(sourceIndex, targetIndex) {
    if (!moveArrayItem(this.contentItems, sourceIndex, targetIndex))
      return false;
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
}

export default GObject.registerClass(
  {
    GTypeName: GTypeNames.TRACK_INFORMATION_CONTENT_ROW,
    Template: ResourceUris.TRACK_INFORMATION_CONTENT_ROW_UI,
    InternalChildren: ["btn-add-field", "btn-add-text"],
    Properties: {
      "content-items": GObject.ParamSpec.jsobject(
        "content-items",
        "Content items",
        "Track information content items",
        GObject.ParamFlags.READABLE,
      ),
    },
  },
  TrackInformationContentRow,
);
