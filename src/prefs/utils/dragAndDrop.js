/**
 * @file dragAndDrop.js
 * @module prefs.utils.dragAndDrop
 *
 * Provides preferences-only helpers for GTK drag-and-drop rendering.
 *
 * Reorderable custom widgets share the same snapshot implementation so GTK
 * renderer and Graphene bounds handling stay consistent across drag sources.
 */

import Graphene from "gi://Graphene";
import Gtk from "gi://Gtk";

/**
 * Renders a GTK widget into a texture suitable for a drag icon.
 *
 * @param {Gtk.Widget} widget - Allocated widget to snapshot.
 * @returns {Gdk.Texture} Rendered drag texture.
 */
export function createDragTexture(widget) {
  const width = widget.get_allocated_width();
  const height = widget.get_allocated_height();
  const paintable = new Gtk.WidgetPaintable({ widget });
  const snapshot = new Gtk.Snapshot();
  paintable.snapshot(snapshot, width, height);

  const bounds = new Graphene.Rect();
  bounds.init(0, 0, width, height);
  return widget
    .get_native()
    .get_renderer()
    .render_texture(snapshot.to_node(), bounds);
}
