/**
 * @file vinyl.js
 * @module shell.ui.components.visualizer.renderers.vinyl
 *
 * Creates, rotates, and paints the Vinyl visualizer renderer.
 *
 * Rotation state is returned to TopBarVisualizer so the surface owner continues
 * to control timeline/lifecycle while Vinyl-specific physics stay local here.
 */

import Cairo from "cairo";
import Clutter from "gi://Clutter";
import St from "gi://St";

import { resolveVisualizerSpeedMultiplier } from "../animation.js";
import {
  VISUALIZER_VINYL_BASE_ROTATION_DEGREES_PER_SECOND,
  VISUALIZER_VINYL_SIZE,
  VISUALIZER_VINYL_STOP_DURATION_SECONDS,
} from "../presentation.js";

export function createVinylArea(parent, repaint) {
  const area = new St.DrawingArea({
    width: VISUALIZER_VINYL_SIZE,
    height: VISUALIZER_VINYL_SIZE,
    yAlign: Clutter.ActorAlign.CENTER,
    reactive: false,
    visible: false,
  });
  area.set_pivot_point(0.5, 0.5);
  area.connect("repaint", repaint);
  parent.add_child(area);
  return area;
}

export function resolveVinylTargetRotationSpeed(animationSpeed) {
  return (
    VISUALIZER_VINYL_BASE_ROTATION_DEGREES_PER_SECOND *
    resolveVisualizerSpeedMultiplier(animationSpeed)
  );
}

export function updateVinylRotation({
  area,
  playing,
  previousSpeed,
  targetSpeed,
  angleDegrees,
  deltaSeconds,
}) {
  let nextSpeed = previousSpeed;
  let frameSpeed = previousSpeed;

  if (playing) {
    nextSpeed = targetSpeed;
    frameSpeed = nextSpeed;
  } else if (previousSpeed > 0 && deltaSeconds > 0) {
    const deceleration = targetSpeed / VISUALIZER_VINYL_STOP_DURATION_SECONDS;
    nextSpeed = Math.max(0, previousSpeed - deceleration * deltaSeconds);
    frameSpeed = (previousSpeed + nextSpeed) / 2;
  }

  let nextAngle = angleDegrees;
  if (deltaSeconds > 0 && frameSpeed > 0) {
    nextAngle = (angleDegrees + frameSpeed * deltaSeconds) % 360;
    area.queue_repaint();
  }

  area.set_rotation_angle(Clutter.RotateAxis.Z_AXIS, nextAngle);
  return {
    angleDegrees: nextAngle,
    rotationDegreesPerSecond: nextSpeed,
  };
}

function setDrawingColor(context, color) {
  context.setSourceRGBA(color.red, color.green, color.blue, color.alpha);
}

export function repaintVinyl(area, color, angleDegrees) {
  const [width, height] = area.get_surface_size();
  if (width <= 0 || height <= 0 || !color) return;

  const context = area.get_context();
  try {
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
  } finally {
    context.$dispose();
  }
}
