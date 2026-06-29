/**
 * @file panel.js
 * @module shared.enums.panel
 *
 * Enum values for placing the MediaShell button in the GNOME Shell panel.
 *
 * Runtime panel insertion and preferences use these stable string IDs to keep
 * the extension position predictable across Shell restarts.
 */

export const PanelPositions = Object.freeze({
  LEFT: "left",
  CENTER: "center",
  RIGHT: "right",
});
