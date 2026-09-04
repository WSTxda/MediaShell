/**
 * @file media-app-selection.test.mjs
 * @module tests.mediaAppSelection
 *
 * Protects deterministic active-app selection, cycling, and owner-loss handoff.
 * The suite keeps discovery order and temporary owner loss from changing user selection.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PlaybackStatus } from "../src/shell/mpris/protocol.js";
import {
  chooseActiveMediaApp,
  chooseNextMediaApp,
  chooseReconciledMediaApp,
  orderMediaAppsDeterministically,
} from "../src/shell/mpris/selection.js";
import { runCases } from "./helpers.mjs";

function mediaApp(
  busName,
  playbackStatus,
  { pinned = false, invalid = false } = {},
) {
  return {
    busName,
    playbackStatus,
    isInvalid: invalid,
    get isPinned() {
      return pinned;
    },
  };
}

test("active media-app selection remains deterministic across priority, cycling, and owner handoff", async () => {
  const stopped = mediaApp(
    "org.mpris.MediaPlayer2.stopped",
    PlaybackStatus.STOPPED,
  );
  const current = mediaApp(
    "org.mpris.MediaPlayer2.current",
    PlaybackStatus.STOPPED,
  );
  const paused = mediaApp(
    "org.mpris.MediaPlayer2.paused",
    PlaybackStatus.PAUSED,
  );
  const playing = mediaApp(
    "org.mpris.MediaPlayer2.playing",
    PlaybackStatus.PLAYING,
  );
  const pinned = mediaApp(
    "org.mpris.MediaPlayer2.pinned",
    PlaybackStatus.PAUSED,
    { pinned: true },
  );
  const invalid = mediaApp(
    "org.mpris.MediaPlayer2.invalid",
    PlaybackStatus.PLAYING,
    { pinned: true, invalid: true },
  );

  await runCases([
    [
      "priority",
      () => {
        assert.equal(
          chooseActiveMediaApp(
            [invalid, stopped, current, paused, playing, pinned],
            current.busName,
          ),
          pinned,
        );
        assert.equal(
          chooseActiveMediaApp(
            [stopped, current, paused, playing],
            current.busName,
          ),
          playing,
        );
        assert.equal(
          chooseActiveMediaApp([stopped, current, paused], current.busName),
          current,
        );
        assert.equal(chooseActiveMediaApp([stopped, paused]), paused);
        assert.equal(chooseActiveMediaApp([stopped]), stopped);
        assert.equal(chooseActiveMediaApp([invalid]), null);
      },
    ],
    [
      "equal priority",
      () => {
        const alpha = mediaApp(
          "org.mpris.MediaPlayer2.alpha",
          PlaybackStatus.PLAYING,
        );
        const beta = mediaApp(
          "org.mpris.MediaPlayer2.beta",
          PlaybackStatus.PLAYING,
        );
        const gamma = mediaApp(
          "org.mpris.MediaPlayer2.gamma",
          PlaybackStatus.PLAYING,
        );
        for (const apps of [
          [gamma, alpha, beta],
          [beta, gamma, alpha],
          [alpha, beta, gamma],
        ]) {
          assert.equal(chooseActiveMediaApp(apps, beta.busName), beta);
          assert.equal(chooseActiveMediaApp(apps), alpha);
        }
      },
    ],
    [
      "stable ordering and cycling",
      () => {
        const alpha = mediaApp(
          "org.mpris.MediaPlayer2.alpha",
          PlaybackStatus.STOPPED,
        );
        const beta = mediaApp(
          "org.mpris.MediaPlayer2.beta",
          PlaybackStatus.STOPPED,
        );
        const gamma = mediaApp(
          "org.mpris.MediaPlayer2.gamma",
          PlaybackStatus.STOPPED,
        );
        assert.deepEqual(
          orderMediaAppsDeterministically([gamma, alpha, beta]),
          [alpha, beta, gamma],
        );
        assert.equal(chooseNextMediaApp([alpha]), null);
        assert.equal(
          chooseNextMediaApp([gamma, invalid, alpha, beta], alpha),
          beta,
        );
        assert.equal(chooseNextMediaApp([beta, alpha, gamma], gamma), alpha);
        assert.equal(chooseNextMediaApp([gamma, beta, alpha], null), alpha);
      },
    ],
    [
      "owner loss",
      () => {
        const pending = mediaApp(
          "org.mpris.MediaPlayer2.pending",
          PlaybackStatus.PAUSED,
        );
        const pinnedPending = mediaApp(
          "org.mpris.MediaPlayer2.pinned-pending",
          PlaybackStatus.PAUSED,
          { pinned: true },
        );
        assert.equal(
          chooseReconciledMediaApp([paused], pending.busName, pending),
          null,
        );
        assert.equal(
          chooseReconciledMediaApp([paused, playing], pending.busName, pending),
          playing,
        );
        assert.equal(
          chooseReconciledMediaApp([paused, pinned], pending.busName, pending),
          pinned,
        );
        assert.equal(
          chooseReconciledMediaApp(
            [playing],
            pinnedPending.busName,
            pinnedPending,
          ),
          null,
        );
        assert.equal(
          chooseReconciledMediaApp([paused], paused.busName, null),
          paused,
        );
      },
    ],
  ]);
});
