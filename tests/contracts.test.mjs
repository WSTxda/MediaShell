/**
 * @file contracts.test.mjs
 * @module tests.contracts
 *
 * Proves declarative and AST playback gates accept the project and reject real drift.
 * Negative fixtures keep failures tied to parsed contracts and executable ownership.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "acorn";

import { PlaybackControlIds } from "../src/shared/constants/playbackControls.js";
import { PlaybackControlSurfaces } from "../src/shared/constants/playbackControlSurfaces.js";
import { readAssetManifest } from "../scripts/dev/files.mjs";
import { getJavaScriptRecords } from "../scripts/dev/javascript.mjs";
import {
  createPlaybackContractSnapshot,
  validatePlaybackBoundaryRecord,
  validatePlaybackContractSnapshot,
  validatePlaybackJavaScriptContracts,
  validatePlaybackRendererLifecycle,
} from "../scripts/dev/playback.mjs";
import { runCases } from "./helpers.mjs";

function parsedRecord(file, source) {
  return {
    file,
    source,
    ast: parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
    }),
  };
}

function expectDiagnostic(errors, fragment) {
  assert.ok(
    errors.some((error) => error.includes(fragment)),
    `expected diagnostic containing ${JSON.stringify(fragment)}; received:\n${errors.join("\n")}`,
  );
}

const BASE_SNAPSHOT = createPlaybackContractSnapshot(readAssetManifest());

test("parsed playback, settings, input, and D-Bus contracts reject meaningful drift", async () => {
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
      "order",
      () => {
        const snapshot = structuredClone(BASE_SNAPSHOT);
        [snapshot.orders.popupPrimary[0], snapshot.orders.popupPrimary[1]] = [
          snapshot.orders.popupPrimary[1],
          snapshot.orders.popupPrimary[0],
        ];
        expectDiagnostic(
          validatePlaybackContractSnapshot(snapshot),
          "popupPrimary order",
        );
      },
    ],
    [
      "default",
      () => {
        const snapshot = structuredClone(BASE_SNAPSHOT);
        const previous = snapshot.surfaces[
          PlaybackControlSurfaces.POPUP
        ].controls.find(
          ({ controlId }) => controlId === PlaybackControlIds.PREVIOUS,
        );
        snapshot.schema.keys[previous.settingKey].default = false;
        expectDiagnostic(
          validatePlaybackContractSnapshot(snapshot),
          "unexpected first-install default",
        );
      },
    ],
    [
      "standalone speed",
      () => {
        const snapshot = structuredClone(BASE_SNAPSHOT);
        const speed = snapshot.surfaces[
          PlaybackControlSurfaces.POPUP
        ].controls.find(
          ({ controlId }) => controlId === PlaybackControlIds.SPEED,
        );
        speed.requiresSurfaceEnabled = true;
        expectDiagnostic(
          validatePlaybackContractSnapshot(snapshot),
          "unexpected surface visibility dependency",
        );
      },
    ],
    [
      "flag",
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
      "persisted input",
      () => {
        const snapshot = structuredClone(BASE_SNAPSHOT);
        snapshot.inputActions.SEEK_BACKWARD = 99;
        expectDiagnostic(
          validatePlaybackContractSnapshot(snapshot),
          "persisted input enum",
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

test("AST playback boundaries require shared execution and reachable renderer teardown", async () => {
  let sourceRecords = null;
  await runCases([
    [
      "current source",
      async () => {
        sourceRecords = await getJavaScriptRecords();
        assert.deepEqual(
          validatePlaybackJavaScriptContracts(sourceRecords),
          [],
        );
      },
    ],
    [
      "direct call",
      () => {
        const errors = validatePlaybackBoundaryRecord(
          parsedRecord(
            "src/shell/ui/popup/PopupPlaybackControls.js",
            `
            import { executePlaybackControlAction } from "../../mpris/playbackControlExecutor.js";
            export default class PopupPlaybackControls {
              run(mediaApp) {
                executePlaybackControlAction(mediaApp, "next");
                mediaApp.seek(10);
              }
            }
          `,
          ),
        );
        expectDiagnostic(
          errors,
          "direct playback call seek() bypasses the shared executor",
        );
      },
    ],
    [
      "teardown",
      () => {
        const errors = validatePlaybackRendererLifecycle(
          parsedRecord(
            "src/shell/ui/topBar/TopBarPlaybackControls.js",
            `
            export default class TopBarPlaybackControls {
              create(button) { button.connect("clicked", () => {}); }
              destroy() {}
            }
          `,
          ),
        );
        expectDiagnostic(errors, "clicked signal IDs must be retained");
        expectDiagnostic(
          errors,
          "destroy path does not disconnect control signals",
        );
        expectDiagnostic(
          errors,
          "destroy path does not destroy control actors",
        );
      },
    ],
    [
      "position ownership",
      () => {
        const records = new Map(sourceRecords);
        records.set(
          "src/shell/mpris/PlaybackPositionTracker.js",
          parsedRecord(
            "src/shell/mpris/PlaybackPositionTracker.js",
            `
            import GLib from "gi://GLib";
            import { resolvePlaybackPositionEstimate } from
              "../../shared/utils/playbackPosition.js";
            export default class PlaybackPositionTracker {
              refresh() { GLib.timeout_add(0, 1000, () => 1); }
              estimate() { return 0; }
            }
          `,
          ),
        );
        const errors = validatePlaybackJavaScriptContracts(records);
        expectDiagnostic(errors, "shared position resolver is not called");
        expectDiagnostic(
          errors,
          "late position reads are not generation-guarded",
        );
        expectDiagnostic(
          errors,
          "position tracking must not poll with a GLib source",
        );
      },
    ],
  ]);
});
