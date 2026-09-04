/**
 * @file mpris.test.mjs
 * @module tests.mpris
 *
 * Consolidates MPRIS operation, owner-transition, and normalization contracts.
 * The suite keeps control execution and endpoint replacement independent from GJS.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MPRIS_NO_TRACK_PATH,
  MprisMetadataKeys,
} from "../src/shell/mpris/protocol.js";
import {
  PlaybackControlActions,
  RELATIVE_SEEK_SECONDS,
} from "../src/shared/playback/controls.js";
import { MediaAppValidity } from "../src/shell/mpris/playerValidity.js";
import { LoopStatus, PlaybackStatus } from "../src/shell/mpris/playbackState.js";
import {
  metadataContainsTrack,
  normalizeMprisTrackId,
  normalizeLoopStatus,
  normalizePlaybackStatus,
  resolveMediaAppValidity,
} from "../src/shell/mpris/normalization.js";
import {
  MprisOperationReasons,
  MprisOperationStatuses,
  createMprisOperationResult,
  isMprisOperationResult,
  mprisOperationCancelled,
  mprisOperationFailed,
  mprisOperationSucceeded,
  mprisOperationUnsupported,
  normalizeMprisOperationResult,
} from "../src/shell/mpris/operationResult.js";
import {
  matchesMprisOwnerSnapshot,
  resolveMprisOwnerTransition,
} from "../src/shell/mpris/owner.js";
import {
  executePlaybackControlAction,
  resolveSeekOffsetMicroseconds,
} from "../src/shell/mpris/playbackControlExecutor.js";
import { runCases } from "./helpers.mjs";

test("MPRIS operations return explicit results through one executor", async () => {
  await runCases([
    [
      "result vocabulary",
      () => {
        const results = [
          mprisOperationSucceeded(),
          mprisOperationUnsupported(),
          mprisOperationCancelled(),
          mprisOperationFailed(
            MprisOperationReasons.DBUS_ERROR,
            "org.test.Error",
          ),
        ];
        assert.deepEqual(
          results.map(({ status }) => status),
          ["success", "unsupported", "cancelled", "failed"],
        );
        for (const result of results) {
          assert.equal(Object.isFrozen(result), true);
          assert.equal(isMprisOperationResult(result), true);
        }
        assert.equal(normalizeMprisOperationResult(results[3]), results[3]);
        assert.deepEqual(normalizeMprisOperationResult(undefined), {
          status: MprisOperationStatuses.SUCCESS,
          reason: MprisOperationReasons.COMPLETED,
          errorName: null,
        });
        assert.throws(
          () => createMprisOperationResult("maybe", "invalid"),
          /Unknown MPRIS operation status/,
        );
      },
    ],
    [
      "delegation",
      async () => {
        const expected = mprisOperationFailed(
          MprisOperationReasons.DBUS_ERROR,
          "org.test.Rejected",
        );
        assert.equal(
          await executePlaybackControlAction(
            { playPause: async () => expected },
            PlaybackControlActions.PLAY_PAUSE,
          ),
          expected,
        );
        assert.deepEqual(
          await executePlaybackControlAction(
            null,
            PlaybackControlActions.PLAY_PAUSE,
          ),
          mprisOperationUnsupported(MprisOperationReasons.MISSING_TARGET),
        );
        assert.deepEqual(
          await executePlaybackControlAction(
            {},
            PlaybackControlActions.PLAY_PAUSE,
          ),
          mprisOperationUnsupported(MprisOperationReasons.MISSING_METHOD),
        );
      },
    ],
    [
      "fixed seek",
      async () => {
        assert.equal(RELATIVE_SEEK_SECONDS, 10);
        assert.equal(
          resolveSeekOffsetMicroseconds(PlaybackControlActions.SEEK_BACKWARD),
          -10_000_000,
        );
        assert.equal(
          resolveSeekOffsetMicroseconds(PlaybackControlActions.SEEK_FORWARD),
          10_000_000,
        );
        let received = null;
        await executePlaybackControlAction(
          {
            seek: async (offset) => {
              received = offset;
            },
          },
          PlaybackControlActions.SEEK_FORWARD,
        );
        assert.equal(received, 10_000_000);
      },
    ],
    [
      "speed cycle",
      async () => {
        let received = null;
        const result = await executePlaybackControlAction(
          {
            rate: 1,
            minimumRate: 0.8,
            maximumRate: 1.2,
            setPlaybackRate: async (rate) => {
              received = rate;
              return mprisOperationSucceeded();
            },
          },
          PlaybackControlActions.CYCLE_SPEED,
        );
        assert.equal(result.status, MprisOperationStatuses.SUCCESS);
        assert.equal(received, 1.2);
      },
    ],
  ]);
});

test("MPRIS owner transitions recover replacement processes without accepting stale replies", () => {
  assert.deepEqual(resolveMprisOwnerTransition(null, null), {
    owner: null,
    hasOwner: false,
    changed: false,
  });
  assert.deepEqual(resolveMprisOwnerTransition(null, ":1.10"), {
    owner: ":1.10",
    hasOwner: true,
    changed: true,
  });
  assert.deepEqual(resolveMprisOwnerTransition(":1.10", ":1.10"), {
    owner: ":1.10",
    hasOwner: true,
    changed: false,
  });
  assert.deepEqual(resolveMprisOwnerTransition(":1.10", ":1.11"), {
    owner: ":1.11",
    hasOwner: true,
    changed: true,
  });
  assert.deepEqual(resolveMprisOwnerTransition(":1.10", "  "), {
    owner: null,
    hasOwner: false,
    changed: false,
  });
  assert.equal(matchesMprisOwnerSnapshot(":1.10", 2, ":1.10", 2), true);
  assert.equal(matchesMprisOwnerSnapshot(":1.10", 2, ":1.11", 2), false);
  assert.equal(matchesMprisOwnerSnapshot(":1.10", 2, ":1.10", 3), false);
});

test("untrusted MPRIS state normalizes to specification-safe visibility defaults", async () => {
  await runCases([
    [
      "status and loop",
      () => {
        assert.equal(
          normalizePlaybackStatus(PlaybackStatus.PLAYING),
          PlaybackStatus.PLAYING,
        );
        assert.equal(
          normalizePlaybackStatus("Buffering"),
          PlaybackStatus.STOPPED,
        );
        assert.equal(
          normalizeLoopStatus(LoopStatus.PLAYLIST),
          LoopStatus.PLAYLIST,
        );
        assert.equal(normalizeLoopStatus("Invalid"), LoopStatus.NONE);
      },
    ],
    [
      "track metadata",
      () => {
        assert.equal(
          normalizeMprisTrackId("/org/example/track/1"),
          "/org/example/track/1",
        );
        assert.equal(normalizeMprisTrackId(MPRIS_NO_TRACK_PATH), null);
        assert.equal(normalizeMprisTrackId("not/a/path"), null);
        assert.equal(normalizeMprisTrackId(""), null);
        assert.equal(normalizeMprisTrackId(null), null);

        assert.equal(
          metadataContainsTrack({
            [MprisMetadataKeys.TRACK_ID]: MPRIS_NO_TRACK_PATH,
            [MprisMetadataKeys.TITLE]: "Stale",
          }),
          false,
        );
        assert.equal(
          metadataContainsTrack({
            [MprisMetadataKeys.TRACK_ID]: "/org/example/track/1",
          }),
          true,
        );
        assert.equal(
          metadataContainsTrack({ [MprisMetadataKeys.TITLE]: "Sparse track" }),
          true,
        );
        assert.equal(metadataContainsTrack({}), false);
      },
    ],
    [
      "visibility",
      () => {
        const cases = [
          [
            {
              hasIdentity: false,
              hasTrackMetadata: true,
              hasPresentedTrackMetadata: false,
              playbackStatus: PlaybackStatus.PLAYING,
            },
            MediaAppValidity.INVALID,
          ],
          [
            {
              hasIdentity: true,
              hasTrackMetadata: true,
              hasPresentedTrackMetadata: false,
              playbackStatus: PlaybackStatus.STOPPED,
            },
            MediaAppValidity.VALID,
          ],
          [
            {
              hasIdentity: true,
              hasTrackMetadata: false,
              hasPresentedTrackMetadata: false,
              playbackStatus: PlaybackStatus.PLAYING,
            },
            MediaAppValidity.VALID,
          ],
          [
            {
              hasIdentity: true,
              hasTrackMetadata: false,
              hasPresentedTrackMetadata: true,
              playbackStatus: PlaybackStatus.STOPPED,
            },
            MediaAppValidity.EMPTY_STOPPED_GRACE,
          ],
          [
            {
              hasIdentity: true,
              hasTrackMetadata: false,
              hasPresentedTrackMetadata: false,
              playbackStatus: PlaybackStatus.STOPPED,
            },
            MediaAppValidity.INVALID,
          ],
        ];
        for (const [state, expected] of cases)
          assert.equal(resolveMediaAppValidity(state), expected);
      },
    ],
  ]);
});
