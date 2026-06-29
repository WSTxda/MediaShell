/**
 * @file media-app-selection.test.mjs
 * @module tests.mediaAppSelection
 *
 * Tests deterministic active media-app selection and cycling policy.
 *
 * The policy is pure by design, so pinned, playing, paused, and fallback ordering
 * can be verified without D-Bus, PlayerProxy instances, or Shell UI actors.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PlaybackStatus } from "../src/shared/enums/playback.js";
import {
  selectActiveMediaApp,
  selectNextMediaApp,
} from "../src/shell/mpris/MediaAppSelectionPolicy.js";

function mediaApp(
  busName,
  playbackStatus,
  { pinned = false, invalid = false } = {},
) {
  return {
    busName,
    playbackStatus,
    isMediaAppInvalid: invalid,
    isAppPinned: () => pinned,
  };
}

test("active media app priority is pinned, playing, current, paused, then first valid", () => {
  const stopped = mediaApp("stopped", PlaybackStatus.STOPPED);
  const current = mediaApp("current", PlaybackStatus.STOPPED);
  const paused = mediaApp("paused", PlaybackStatus.PAUSED);
  const playing = mediaApp("playing", PlaybackStatus.PLAYING);
  const pinned = mediaApp("pinned", PlaybackStatus.PAUSED, { pinned: true });
  const invalidPinned = mediaApp("invalid", PlaybackStatus.PLAYING, {
    pinned: true,
    invalid: true,
  });

  assert.equal(
    selectActiveMediaApp(
      [invalidPinned, stopped, current, paused, playing, pinned],
      "current",
    ),
    pinned,
  );
  assert.equal(
    selectActiveMediaApp([stopped, current, paused, playing], "current"),
    playing,
  );
  assert.equal(
    selectActiveMediaApp([stopped, current, paused], "current"),
    current,
  );
  assert.equal(selectActiveMediaApp([stopped, paused]), paused);
  assert.equal(selectActiveMediaApp([stopped]), stopped);
  assert.equal(selectActiveMediaApp([invalidPinned]), null);
});

test("next media app cycles deterministically", () => {
  const first = mediaApp("first", PlaybackStatus.STOPPED);
  const second = mediaApp("second", PlaybackStatus.STOPPED);
  const third = mediaApp("third", PlaybackStatus.STOPPED);

  assert.equal(selectNextMediaApp([first]), null);
  assert.equal(selectNextMediaApp([first, second, third], first), second);
  assert.equal(selectNextMediaApp([first, second, third], third), first);
  assert.equal(selectNextMediaApp([first, second, third], null), first);
});
