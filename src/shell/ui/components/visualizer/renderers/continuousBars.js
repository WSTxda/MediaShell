/**
 * @file continuousBars.js
 * @module shell.ui.components.visualizer.renderers.continuousBars
 *
 * Creates and updates the shared Beats/Pulse continuous-bar renderer.
 *
 * Beats and Pulse intentionally share actor structure. Their style definition
 * supplies the CSS class and pivot while TopBarVisualizer owns animation state.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";

import {
  VISUALIZER_BAR_HEIGHT,
  VISUALIZER_BAR_WIDTH,
} from "../presentation.js";

export function createContinuousBars(parent, definition) {
  return Array.from({ length: definition.elementCount }, () => {
    const bar = new St.Widget({
      styleClass: definition.barStyleClass,
      width: VISUALIZER_BAR_WIDTH,
      height: VISUALIZER_BAR_HEIGHT,
      yAlign: Clutter.ActorAlign.CENTER,
      reactive: false,
    });
    parent.add_child(bar);
    return bar;
  });
}

export function configureContinuousBars(
  bars,
  { visible, barStyleClass = null, pivotY = 0.5 },
) {
  for (const bar of bars) {
    bar.visible = visible;
    if (!visible) continue;
    bar.set_style_class_name(barStyleClass);
    bar.set_pivot_point(0.5, pivotY);
  }
}

export function setContinuousBarsColor(bars, style) {
  for (const bar of bars) bar.set_style(style);
}

export function updateContinuousBars(bars, levels) {
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];
    const nextScale = levels[index];
    if (Math.abs(bar.scale_y - nextScale) > Number.EPSILON)
      bar.set_scale(1, nextScale);
  }
}
