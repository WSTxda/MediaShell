/**
 * @file surfaceState.js
 * @module shell.media.playback.surfaceState
 *
 * Resolves playback-control visibility from surface settings and effective
 * playback capabilities.
 *
 * Manual mode preserves the configured per-control visibility, including
 * unavailable controls that render inactive. Adaptive and Full ignore the
 * manual values and only expose controls that are currently executable.
 */

import { PlaybackControlIds } from "../../../shared/playback/controls.js";
import {
  PlaybackControlModes,
  PlaybackControlSurfaceDefinitions,
} from "../../../shared/playback/surfaces.js";
import { resolvePlaybackControlState } from "./controlState.js";

const ADAPTIVE_PREFERRED_CONTROLS = Object.freeze({
  [PlaybackControlIds.SEEK_BACKWARD]: PlaybackControlIds.PREVIOUS,
  [PlaybackControlIds.SEEK_FORWARD]: PlaybackControlIds.NEXT,
});

function resolvePlaybackControlSurfaceDefinition(surface) {
  const definition = PlaybackControlSurfaceDefinitions[surface];
  if (!definition)
    throw new TypeError(`Unknown playback control surface: ${String(surface)}`);
  return definition;
}

function resolveSurfaceControl(definition, controlId) {
  const control = definition.controls.find(
    (candidate) => candidate.controlId === controlId,
  );
  if (!control)
    throw new TypeError(`Unknown playback control: ${String(controlId)}`);
  return control;
}

function isControlExecutable(player, controlId) {
  return Boolean(
    player && resolvePlaybackControlState(player, controlId).isReactive,
  );
}

function isAdaptiveControlVisible(player, controlId) {
  if (!isControlExecutable(player, controlId)) return false;

  const preferredControlId = ADAPTIVE_PREFERRED_CONTROLS[controlId];
  return (
    preferredControlId === undefined ||
    !isControlExecutable(player, preferredControlId)
  );
}

function isControlVisible(settingsTarget, player, definition, control) {
  if (!settingsTarget?.[definition.show.property]) return false;

  switch (settingsTarget?.[definition.mode.property]) {
    case PlaybackControlModes.ADAPTIVE:
      return isAdaptiveControlVisible(player, control.controlId);
    case PlaybackControlModes.FULL:
      return isControlExecutable(player, control.controlId);
    case PlaybackControlModes.MANUAL:
    default:
      return Boolean(settingsTarget?.[control.property]);
  }
}

/**
 * Resolves effective visibility for one control in a playback surface.
 *
 * @param {object} settingsTarget - Surface settings scope.
 * @param {object|null} player - Active normalized MPRIS player.
 * @param {string} surface - Stable playback-control surface ID.
 * @param {string} controlId - Stable playback-control ID.
 * @returns {boolean} Whether the control should be rendered.
 */
export function isPlaybackControlVisible(
  settingsTarget,
  player,
  surface,
  controlId,
) {
  const definition = resolvePlaybackControlSurfaceDefinition(surface);
  return isControlVisible(
    settingsTarget,
    player,
    definition,
    resolveSurfaceControl(definition, controlId),
  );
}

/**
 * Resolves whether a playback-control surface has any visible controls.
 *
 * @param {object} settingsTarget - Surface settings scope.
 * @param {object|null} player - Active normalized MPRIS player.
 * @param {string} surface - Stable playback-control surface ID.
 * @returns {boolean} Whether the surface should be rendered.
 */
export function isPlaybackControlSurfaceVisible(
  settingsTarget,
  player,
  surface,
) {
  const definition = resolvePlaybackControlSurfaceDefinition(surface);
  return definition.controls.some((control) =>
    isControlVisible(settingsTarget, player, definition, control),
  );
}

/**
 * Resolves only playback controls whose surface-local dirty region changed.
 *
 * The media domain owns visibility policy but deliberately does not know popup
 * or top-bar region values. Each surface supplies its own control-to-region map.
 *
 * @param {object} settingsTarget - Surface settings scope.
 * @param {object|null} player - Active normalized MPRIS player.
 * @param {string} surface - Stable playback-control surface ID.
 * @param {Record<string, number>} controlRegions - Surface-local region map.
 * @param {number} dirtyRegions - Coalesced dirty-region mask.
 * @returns {Array<{controlId: string, isVisible: boolean}>} Changed controls.
 */
export function resolvePlaybackControlSurfaceUpdates(
  settingsTarget,
  player,
  surface,
  controlRegions,
  dirtyRegions,
) {
  const definition = resolvePlaybackControlSurfaceDefinition(surface);
  return definition.controls
    .filter(({ controlId }) =>
      Boolean(dirtyRegions & controlRegions[controlId]),
    )
    .map((control) => ({
      controlId: control.controlId,
      isVisible: isControlVisible(settingsTarget, player, definition, control),
    }));
}
