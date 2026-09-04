/**
 * @file drawing.js
 * @module shell.ui.components.visualizer.drawing
 *
 * Draws the Cairo-backed top-bar visualizer styles without owning runtime state.
 *
 * TopBarVisualizer owns the DrawingArea actors, animation state, repaint
 * callbacks, and Cairo-context disposal. This module receives complete frame
 * data and applies only stateless drawing operations.
 */

import Cairo from "cairo";

import {
  VISUALIZER_SPECTRUM_AMPLITUDE,
  VISUALIZER_SPECTRUM_HORIZONTAL_PADDING,
  VISUALIZER_SPECTRUM_STROKE_WIDTH,
} from "../../../constants/visualizer.js";

function setDrawingColor(context, color, opacity = 1) {
  context.setSourceRGBA(
    color.red,
    color.green,
    color.blue,
    color.alpha * opacity,
  );
}

export function drawSpectrumLayer(
  context,
  offsets,
  width,
  height,
  color,
  opacity,
) {
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

export function drawVinyl(context, width, height, color, angleDegrees) {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(0, Math.min(width, height) / 2 - 0.75);
  if (radius <= 0) return;

  context.newPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  setDrawingColor(context, color);
  context.fill();

  const labelRadius = radius * 0.46;
  const spindleRadius = labelRadius * 0.24;
  const ringThickness = Math.max(1, radius - labelRadius);
  const grooveRadius = labelRadius + ringThickness * 0.5;
  const phase = (angleDegrees * Math.PI) / 180;
  const grooveExpansion = (Math.sin(phase) + 1) / 2;
  const firstStartAngle = -1.36;
  const secondStartAngle = firstStartAngle + Math.PI;
  const grooveSpan = 0.34 + grooveExpansion * 0.78;
  const grooveWidth = ringThickness * (0.38 + grooveExpansion * 0.12);

  context.save();
  context.setOperator(Cairo.Operator.CLEAR);

  context.newPath();
  context.arc(centerX, centerY, labelRadius, 0, Math.PI * 2);
  context.fill();

  context.setLineCap(Cairo.LineCap.BUTT);
  context.setLineWidth(grooveWidth);

  context.newPath();
  context.arc(
    centerX,
    centerY,
    grooveRadius,
    firstStartAngle,
    firstStartAngle + grooveSpan,
  );
  context.stroke();

  context.newPath();
  context.arc(
    centerX,
    centerY,
    grooveRadius,
    secondStartAngle,
    secondStartAngle + grooveSpan,
  );
  context.stroke();

  context.restore();

  context.newPath();
  context.arc(centerX, centerY, spindleRadius, 0, Math.PI * 2);
  setDrawingColor(context, color);
  context.fill();
}
