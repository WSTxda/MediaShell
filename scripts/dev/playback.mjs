/**
 * @file playback.mjs
 * @module scripts.dev.playback
 *
 * Validates stable playback definitions against settings, UI, and D-Bus assets.
 */

import { fail, readAssetManifest } from "./files.mjs";
import {
  createPlaybackContractSnapshot,
  validatePlaybackContractSnapshot,
} from "./playbackContracts.mjs";

export {
  createPlaybackContractSnapshot,
  validatePlaybackContractSnapshot,
} from "./playbackContracts.mjs";

/** Runs playback cross-file integrity checks. */
export async function checkPlaybackContracts() {
  const snapshot = createPlaybackContractSnapshot(readAssetManifest());
  const errors = validatePlaybackContractSnapshot(snapshot);
  fail("Playback contract validation", errors);
  console.log(
    "Playback IDs, settings ownership, surface regions, inputs, and MPRIS signatures passed.",
  );
}
