/**
 * @file contracts.test.mjs
 * @module tests.contracts
 *
 * Proves that playback cross-file contracts accept the project and reject
 * corruption that would break settings, rendering, input, or D-Bus behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PlaybackControlIds } from "../src/shared/constants/playbackControls.js";
import { PlaybackControlSurfaces } from "../src/shared/constants/playbackControlSurfaces.js";
import { readAssetManifest } from "../scripts/dev/files.mjs";
import {
  createPlaybackContractSnapshot,
  validatePlaybackContractSnapshot,
} from "../scripts/dev/playback.mjs";
import { runCases } from "./helpers.mjs";

function expectDiagnostic(errors, fragment) {
  assert.ok(
    errors.some((error) => error.includes(fragment)),
    `expected diagnostic containing ${JSON.stringify(fragment)}; received:\n${errors.join("\n")}`,
  );
}

const BASE_SNAPSHOT = createPlaybackContractSnapshot(readAssetManifest());

test("playback contracts reject broken cross-file references", async () => {
  await runCases([
    [
      "current snapshot",
      () => {
        assert.deepEqual(
          validatePlaybackContractSnapshot(structuredClone(BASE_SNAPSHOT)),
          [],
        );
      },
    ],
    [
      "duplicate control identity",
      () => {
        const snapshot = structuredClone(BASE_SNAPSHOT);
        snapshot.controls[1].id = snapshot.controls[0].id;
        expectDiagnostic(
          validatePlaybackContractSnapshot(snapshot),
          "duplicate ID",
        );
      },
    ],
    [
      "unknown surface control",
      () => {
        const snapshot = structuredClone(BASE_SNAPSHOT);
        snapshot.surfaces[PlaybackControlSurfaces.POPUP].controls[0].controlId =
          "missing-control";
        expectDiagnostic(
          validatePlaybackContractSnapshot(snapshot),
          "unknown control policy",
        );
      },
    ],
    [
      "settings ownership",
      () => {
        const snapshot = structuredClone(BASE_SNAPSHOT);
        const previous = snapshot.surfaces[
          PlaybackControlSurfaces.POPUP
        ].controls.find(
          ({ controlId }) => controlId === PlaybackControlIds.PREVIOUS,
        );
        snapshot.settingsSpec[previous.settingKey].property = "wrongProperty";
        expectDiagnostic(
          validatePlaybackContractSnapshot(snapshot),
          "surface policy and SETTINGS_SPEC differ",
        );
      },
    ],
    [
      "widget flag collision",
      () => {
        const snapshot = structuredClone(BASE_SNAPSHOT);
        snapshot.widgetFlags.POPUP_PLAYBACK_PREVIOUS =
          snapshot.widgetFlags.POPUP_PLAYBACK_PLAY_PAUSE;
        expectDiagnostic(
          validatePlaybackContractSnapshot(snapshot),
          "duplicate individual bit",
        );
      },
    ],
    [
      "missing shortcut key",
      () => {
        const snapshot = structuredClone(BASE_SNAPSHOT);
        delete snapshot.schema.keys[snapshot.inputDefinitions[0].shortcutKey];
        expectDiagnostic(
          validatePlaybackContractSnapshot(snapshot),
          "shortcut schema key is missing",
        );
      },
    ],
    [
      "D-Bus signature",
      () => {
        const snapshot = structuredClone(BASE_SNAPSHOT);
        snapshot.dbusSignatures[
          "org.mpris.MediaPlayer2.Player"
        ].method.Seek[0].type = "u";
        expectDiagnostic(
          validatePlaybackContractSnapshot(snapshot),
          "MPRIS Seek signature",
        );
      },
    ],
  ]);
});
