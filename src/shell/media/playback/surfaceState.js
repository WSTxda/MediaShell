/**
 * @file surfaceState.js
 * @module shell.media.playback.surfaceState
 *
 * Resolves playback-control visibility from the shared surface settings policy.
 *
 * Functions in this module are pure and accept a SettingsStore target rather
 * than a live Gio.Settings object, keeping them usable by Shell and Node tests.
 */

import { PlaybackControlSurfaceDefinitions } from "../../../shared/playback/surfaces.js";
import { getPlaybackControlSurfaceUpdates } from "./surfaceUpdates.js";

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
 * @param {object} settingsTarget - Runtime object populated by SettingsStore.
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
 * Resolves only controls affected by a WidgetFlags update.
 *
 * @param {object} settingsTarget - Runtime object populated by SettingsStore.
 * @param {string} surface - Stable playback-control surface ID.
 * @param {number} widgetFlags - Coalesced WidgetFlags mask.
 * @returns {Array<{controlId: string, isVisible: boolean}>} Changed controls.
 */
export function resolvePlaybackControlSurfaceUpdates(
  settingsTarget,
  surface,
  widgetFlags,
) {
  const { show, controls } = getPlaybackControlSurfaceDefinition(surface);
  const updates = getPlaybackControlSurfaceUpdates(surface);
  return controls
    .filter(({ controlId }) => Boolean(widgetFlags & updates.controls[controlId]))
    .map((control) => ({
      controlId: control.controlId,
      isVisible: isPlaybackControlVisible(settingsTarget, show, control),
    }));
}
