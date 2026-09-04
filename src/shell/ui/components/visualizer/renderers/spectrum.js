/**
 * @file spectrum.js
 * @module shell.ui.components.visualizer.renderers.spectrum
 *
 * Owns the stateless actor construction and Cairo drawing for Spectrum frames.
 * Animation samples remain owned by TopBarVisualizer.
 */

import Cairo from "cairo";
import Clutter from "gi://Clutter";
import St from "gi://St";

import {
  VISUALIZER_HEIGHT,
  VISUALIZER_SPECTRUM_AMPLITUDE,
  VISUALIZER_SPECTRUM_HORIZONTAL_PADDING,
  VISUALIZER_SPECTRUM_STROKE_WIDTH,
  VISUALIZER_SPECTRUM_WIDTH,
} from "../presentation.js";

export function createSpectrumArea(parent, repaint) {
  const area = new St.DrawingArea({
    width: VISUALIZER_SPECTRUM_WIDTH,
    height: VISUALIZER_HEIGHT,
    yAlign: Clutter.ActorAlign.CENTER,
    reactive: false,
    visible: false,
  });
  area.connect("repaint", repaint);
  parent.add_child(area);
  return area;
}

function setDrawingColor(context, color, opacity = 1) {
  context.setSourceRGBA(
    color.red,
    color.green,
    color.blue,
    color.alpha * opacity,
  );
}

function drawSpectrumLayer(context, offsets, width, height, color, opacity) {
  const baseline = height / 2;
  const verticalAmplitude = Math.min(
    VISUALIZER_SPECTRUM_AMPLITUDE,
    Math.max(0, (height - VISUALIZER_SPECTRUM_STROKE_WIDTH) / 2),
  );
  const drawableWidth = Math.max(
    0,
    width - VISUALIZER_SPECTRUM_HORIZONTAL_PADDING * 2,
  );
  const lastIndex = offsets.length - 1;
  const pointSpacing = drawableWidth / lastIndex;

  context.newPath();
  setDrawingColor(context, color, opacity);
  context.setLineWidth(VISUALIZER_SPECTRUM_STROKE_WIDTH);
  context.setLineCap(Cairo.LineCap.ROUND);
  context.setLineJoin(Cairo.LineJoin.ROUND);
  context.moveTo(VISUALIZER_SPECTRUM_HORIZONTAL_PADDING, baseline);

  for (let index = 0; index < lastIndex; index++) {
    const previousIndex = Math.max(0, index - 1);
    const nextIndex = index + 1;
    const followingIndex = Math.min(lastIndex, index + 2);
    const currentX =
      VISUALIZER_SPECTRUM_HORIZONTAL_PADDING + pointSpacing * index;
    const nextX =
      VISUALIZER_SPECTRUM_HORIZONTAL_PADDING + pointSpacing * nextIndex;
    const currentY = baseline - offsets[index] * verticalAmplitude;
    const previousY = baseline - offsets[previousIndex] * verticalAmplitude;
    const nextY = baseline - offsets[nextIndex] * verticalAmplitude;
    const followingY = baseline - offsets[followingIndex] * verticalAmplitude;
    const firstControlY =
      index === 0 ? currentY : currentY + (nextY - previousY) / 6;
    const secondControlY =
      nextIndex === lastIndex ? nextY : nextY - (followingY - currentY) / 6;

    context.curveTo(
      currentX + pointSpacing / 3,
      firstControlY,
      nextX - pointSpacing / 3,
      secondControlY,
      nextX,
      nextY,
    );
  }

  context.stroke();
}

export function repaintSpectrum(
  area,
  backgroundOffsets,
  foregroundOffsets,
  color,
  backgroundOpacity,
) {
  const [width, height] = area.get_surface_size();
  if (width <= 0 || height <= 0 || !color) return;

  const context = area.get_context();
  try {
    drawSpectrumLayer(
      context,
      backgroundOffsets,
      width,
      height,
      color,
      backgroundOpacity,
    );
    drawSpectrumLayer(context, foregroundOffsets, width, height, color, 1);
  } finally {
    context.$dispose();
  }
}
