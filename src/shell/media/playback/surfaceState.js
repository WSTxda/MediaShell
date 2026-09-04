/**
 * @file surfaceState.js
 * @module shell.media.playback.surfaceState
 *
 * Resolves playback-control visibility from the shared surface settings policy.
 *
 * Functions in this module are pure and accept a the scoped settings runtime target rather
 * than a live Gio.Settings object, keeping them usable by Shell and Node tests.
 */

import { PlaybackControlSurfaceDefinitions } from "../../../shared/playback/surfaces.js";

/**
 * Returns the canonical definition for a playback-control surface.
 *
 * @param {string} surface - Stable playback-control surface ID.
 * @returns {object} Frozen surface definition.
 * @throws {TypeError} When the surface is unknown.
 */
function getPlaybackControlSurfaceDefinition(surface) {
  const definition = PlaybackControlSurfaceDefinitions[surface];
  if (!definition)
    throw new TypeError(`Unknown playback control surface: ${String(surface)}`);
  return definition;
}

function isPlaybackControlVisible(settingsTarget, show, control) {
  return Boolean(
    settingsTarget?.[show.property] && settingsTarget?.[control.property],
  );
}

/**
 * Resolves whether a playback-control surface has any visible controls.
 *
 * @param {object} settingsTarget - Surface settings scope.
 * @param {string} surface - Stable playback-control surface ID.
 * @returns {boolean} Whether the surface should be rendered.
 */
export function isPlaybackControlSurfaceVisible(settingsTarget, surface) {
  const { show, controls } = getPlaybackControlSurfaceDefinition(surface);
  return controls.some((control) =>
    isPlaybackControlVisible(settingsTarget, show, control),
  );
}

/**
 * Resolves only playback controls whose surface-local dirty region changed.
 *
 * The media domain owns visibility policy but deliberately does not know popup
 * or top-bar region values. Each surface supplies its own control-to-region map.
 *
 * @param {object} settingsTarget - Surface settings scope.
 * @param {string} surface - Stable playback-control surface ID.
 * @param {Record<string, number>} controlRegions - Surface-local region map.
 * @param {number} dirtyRegions - Coalesced dirty-region mask.
 * @returns {Array<{controlId: string, isVisible: boolean}>} Changed controls.
 */
export function resolvePlaybackControlSurfaceUpdates(
  settingsTarget,
  surface,
  controlRegions,
  dirtyRegions,
) {
  const { show, controls } = getPlaybackControlSurfaceDefinition(surface);
  return controls
    .filter(({ controlId }) =>
      Boolean(dirtyRegions & controlRegions[controlId]),
    )
    .map((control) => ({
      controlId: control.controlId,
      isVisible: isPlaybackControlVisible(settingsTarget, show, control),
    }));
}
