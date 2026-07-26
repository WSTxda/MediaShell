/**
 * @file playback.mjs
 * @module scripts.dev.playback
 *
 * Orchestrates playback table and JavaScript architecture validation.
 *
 * Runtime tables are compared with parsed assets, while Shell-only modules are
 * inspected through the shared Acorn cache without importing GNOME APIs in Node.
 */

import { fail, readAssetManifest } from "./files.mjs";
import { getJavaScriptRecords } from "./javascript.mjs";
import {
  createPlaybackContractSnapshot,
  validatePlaybackContractSnapshot,
} from "./playbackContracts.mjs";
import { validatePlaybackJavaScriptContracts } from "./playbackJavaScript.mjs";

export {
  createPlaybackContractSnapshot,
  validatePlaybackContractSnapshot,
} from "./playbackContracts.mjs";
export {
  validatePlaybackBoundaryRecord,
  validatePlaybackJavaScriptContracts,
  validatePlaybackRendererLifecycle,
} from "./playbackJavaScript.mjs";

/** Runs the complete playback architecture contract group. */
export async function checkPlaybackContracts() {
  const manifest = readAssetManifest();
  const snapshot = createPlaybackContractSnapshot(manifest);
  const records = await getJavaScriptRecords();
  const errors = [
    ...validatePlaybackContractSnapshot(snapshot),
    ...validatePlaybackJavaScriptContracts(records),
  ];
  fail("Playback architecture validation", errors);
  console.log(
    "Playback definitions, surfaces, defaults, flags, inputs, D-Bus " +
      "signatures, execution boundaries, and renderer teardown passed.",
  );
}
