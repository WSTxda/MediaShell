/**
 * @file playback-control-state.test.mjs
 * @module tests.playbackControlState
 *
 * Tests shared semantic state for primary, repeat, and shuffle controls.
 *
 * Popup and top-bar renderers consume these decisions independently, so the
 * suite prevents their button descriptors, sensitivity, and actions from drifting.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PlaybackControls } from "../src/shared/constants/playbackControls.js";
import { LoopStatus, PlaybackStatus } from "../src/shared/enums/playback.js";
import {
  resolveLoopControl,
  resolvePlayPauseControl,
  resolveShuffleControl,
} from "../src/shared/utils/playbackControlState.js";

function createMediaApp(overrides = {}) {
  const calls = [];
  return {
    calls,
    playbackStatus: PlaybackStatus.PAUSED,
    loopStatus: LoopStatus.NONE,
    shuffle: false,
    canControl: true,
    canPlay: true,
    canPause: true,
    play: () => calls.push("play"),
    pause: () => calls.push("pause"),
    stop: () => calls.push("stop"),
    toggleLoop: () => calls.push("loop"),
    toggleShuffle: () => calls.push("shuffle"),
    ...overrides,
  };
}

test("primary playback state selects play, pause, and stop safely", () => {
  const paused = createMediaApp();
  const playState = resolvePlayPauseControl(paused);
  assert.equal(playState.control, PlaybackControls.PLAY);
  assert.equal(playState.isReactive, true);
  playState.action();
  assert.deepEqual(paused.calls, ["play"]);

  const playing = createMediaApp({
    playbackStatus: PlaybackStatus.PLAYING,
  });
  assert.equal(
    resolvePlayPauseControl(playing).control,
    PlaybackControls.PAUSE,
  );

  const cannotPause = createMediaApp({
    playbackStatus: PlaybackStatus.PLAYING,
    canPause: false,
  });
  assert.equal(
    resolvePlayPauseControl(cannotPause).control,
    PlaybackControls.STOP,
  );
});

test("repeat and shuffle state expose one shared active-state contract", () => {
  const mediaApp = createMediaApp({
    loopStatus: LoopStatus.TRACK,
    shuffle: true,
  });
  const loopState = resolveLoopControl(mediaApp);
  const shuffleState = resolveShuffleControl(mediaApp);

  assert.equal(loopState.control, PlaybackControls.LOOP_TRACK);
  assert.equal(loopState.isActive, true);
  assert.equal(shuffleState.control, PlaybackControls.SHUFFLE_ON);
  assert.equal(shuffleState.isActive, true);
  loopState.action();
  shuffleState.action();
  assert.deepEqual(mediaApp.calls, ["loop", "shuffle"]);
});
