/**
 * @file classic.js
 * @module shell.ui.components.visualizer.renderers.classic
 *
 * Creates and updates the segmented Classic visualizer renderer.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";

import { ACTIVE_OPACITY } from "../../../actorState.js";
import {
  VISUALIZER_CLASSIC_COLUMN_WIDTH,
  VISUALIZER_CLASSIC_SEGMENT_COUNT,
  VISUALIZER_CLASSIC_SEGMENT_HEIGHT,
  VISUALIZER_CLASSIC_UNLIT_OPACITY,
} from "../presentation.js";

function createClassicColumn(parent, definition) {
  const column = new St.BoxLayout({
    styleClass: definition.columnStyleClass,
    orientation: Clutter.Orientation.VERTICAL,
    width: VISUALIZER_CLASSIC_COLUMN_WIDTH,
    yAlign: Clutter.ActorAlign.CENTER,
    reactive: false,
  });
  column.blocks = Array.from(
    { length: VISUALIZER_CLASSIC_SEGMENT_COUNT },
    () => {
      const block = new St.Widget({
        styleClass: definition.segmentStyleClass,
        width: VISUALIZER_CLASSIC_COLUMN_WIDTH,
        height: VISUALIZER_CLASSIC_SEGMENT_HEIGHT,
        reactive: false,
      });
      column.add_child(block);
      return block;
    },
  );
  parent.add_child(column);
  return column;
}

export function createClassicColumns(parent, definition) {
  return Array.from({ length: definition.elementCount }, () =>
    createClassicColumn(parent, definition),
  );
}

export function setClassicColumnsVisible(columns, visible) {
  for (const column of columns) column.visible = visible;
}

export function setClassicColumnsColor(columns, style) {
  for (const column of columns)
    for (const block of column.blocks) block.set_style(style);
}

/** Lights each column from the bottom according to its sampled level. */
export function updateClassicColumns(columns, levels) {
  for (let index = 0; index < columns.length; index++) {
    const blocks = columns[index].blocks;
    const activeSegments = Math.max(
      1,
      Math.min(
        VISUALIZER_CLASSIC_SEGMENT_COUNT,
        Math.round(levels[index] * VISUALIZER_CLASSIC_SEGMENT_COUNT),
      ),
    );

    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const segmentFromBottom = blocks.length - blockIndex;
      const nextOpacity =
        segmentFromBottom <= activeSegments
          ? ACTIVE_OPACITY
          : VISUALIZER_CLASSIC_UNLIT_OPACITY;
      const block = blocks[blockIndex];
      if (block.opacity !== nextOpacity) block.opacity = nextOpacity;
    }
  }
}
