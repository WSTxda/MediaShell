/**
 * @file playback-position.test.mjs
 * @module tests.playbackPosition
 *
 * Protects pure position projection and stable track-context decisions.
 * The suite covers long-running media, clock discontinuity, and metadata enrichment.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MPRIS_NO_TRACK_PATH,
  MprisMetadataKeys,
} from "../src/shell/mpris/protocol.js";
import {
  POSITION_CLOCK_DRIFT_TOLERANCE_MICROSECONDS,
  POSITION_ESTIMATE_MAX_AGE_MICROSECONDS,
} from "../src/shell/mpris/positionConstants.js";
import { PlaybackStatus } from "../src/shell/mpris/playbackState.js";
import {
  normalizePlaybackPositionMicroseconds,
  normalizePositionPlaybackRate,
  normalizeTrackDurationMicroseconds,
  resolvePlaybackPositionEstimate,
  resolvePlaybackPositionTrackContext,
} from "../src/shell/mpris/positionProjection.js";
import { runCases } from "./helpers.mjs";

function estimate(overrides = {}) {
  return resolvePlaybackPositionEstimate({
    positionMicroseconds: 10_000_000,
    durationMicroseconds: 120_000_000,
    playbackStatus: PlaybackStatus.PLAYING,
    playbackRate: 1,
    anchorMonotonicMicroseconds: 1_000_000,
    currentMonotonicMicroseconds: 6_000_000,
    anchorRealMicroseconds: 11_000_000,
    currentRealMicroseconds: 16_000_000,
    ...overrides,
  });
}

test("position projection follows monotonic time without a product-specific 24-hour ceiling", async () => {
  await runCases([
    [
      "normalization",
      () => {
        assert.equal(
          normalizeTrackDurationMicroseconds(120_000_000),
          120_000_000,
        );
        assert.equal(
          normalizeTrackDurationMicroseconds(30 * 60 * 60 * 1_000_000),
          108_000_000_000,
        );
        assert.equal(normalizeTrackDurationMicroseconds(0), null);
        assert.equal(normalizePlaybackPositionMicroseconds(-1, null), 0);
        assert.equal(
          normalizePlaybackPositionMicroseconds(12_000_000, 10_000_000),
          10_000_000,
        );
        assert.equal(normalizePositionPlaybackRate(1.5), 1.5);
        assert.equal(normalizePositionPlaybackRate(0), 1);
      },
    ],
    [
      "playing and rate",
      () => {
        assert.deepEqual(estimate(), {
          positionMicroseconds: 15_000_000,
          shouldRefresh: false,
          clockDiscontinuity: false,
        });
        assert.deepEqual(estimate({ playbackRate: 1.5 }), {
          positionMicroseconds: 17_500_000,
          shouldRefresh: false,
          clockDiscontinuity: false,
        });
      },
    ],
    [
      "paused and stopped",
      () => {
        for (const playbackStatus of [
          PlaybackStatus.PAUSED,
          PlaybackStatus.STOPPED,
        ])
          assert.deepEqual(estimate({ playbackStatus }), {
            positionMicroseconds: 10_000_000,
            shouldRefresh: false,
            clockDiscontinuity: false,
          });
      },
    ],
    [
      "known duration",
      () => {
        assert.deepEqual(
          estimate({
            positionMicroseconds: 9_000_000,
            durationMicroseconds: 10_000_000,
            currentMonotonicMicroseconds: 20_000_000,
            currentRealMicroseconds: 30_000_000,
          }),
          {
            positionMicroseconds: 10_000_000,
            shouldRefresh: false,
            clockDiscontinuity: false,
          },
        );
      },
    ],
    [
      "unknown long duration",
      () => {
        const twentyFiveHours = 25 * 60 * 60 * 1_000_000;
        const projected = resolvePlaybackPositionEstimate({
          positionMicroseconds: twentyFiveHours,
          durationMicroseconds: null,
          playbackStatus: PlaybackStatus.PLAYING,
          playbackRate: 1,
          anchorMonotonicMicroseconds: 1_000_000,
          currentMonotonicMicroseconds: 2_000_000,
          anchorRealMicroseconds: 11_000_000,
          currentRealMicroseconds: 12_000_000,
        });
        assert.equal(
          projected.positionMicroseconds,
          twentyFiveHours + 1_000_000,
        );
      },
    ],
    [
      "refresh and discontinuity",
      () => {
        const elapsed = POSITION_ESTIMATE_MAX_AGE_MICROSECONDS + 1;
        assert.equal(
          estimate({
            currentMonotonicMicroseconds: 1_000_000 + elapsed,
            currentRealMicroseconds: 11_000_000 + elapsed,
          }).shouldRefresh,
          true,
        );
        const drift = POSITION_CLOCK_DRIFT_TOLERANCE_MICROSECONDS + 1;
        assert.deepEqual(
          estimate({ currentRealMicroseconds: 16_000_000 + drift }),
          {
            positionMicroseconds: 10_000_000,
            shouldRefresh: true,
            clockDiscontinuity: true,
          },
        );
      },
    ],
  ]);
});

test("track identity remains stable when presentation metadata changes", async () => {
  await runCases([
    [
      "track ID",
      () => {
        const base = {
          [MprisMetadataKeys.TRACK_ID]: "/org/example/Track/1",
          [MprisMetadataKeys.LENGTH]: 180_000_000,
          [MprisMetadataKeys.TITLE]: "Track",
          [MprisMetadataKeys.ART_URL]: "file:///cover-a.jpg",
        };
        const first = resolvePlaybackPositionTrackContext(base);
        const enriched = resolvePlaybackPositionTrackContext({
          ...base,
          [MprisMetadataKeys.ART_URL]: "file:///cover-b.jpg",
          [MprisMetadataKeys.ALBUM]: "Album",
        });
        assert.deepEqual(first, {
          identity: "track-id:/org/example/Track/1",
          durationMicroseconds: 180_000_000,
        });
        assert.equal(enriched.identity, first.identity);
      },
    ],
    [
      "sparse fallback",
      () => {
        const first = resolvePlaybackPositionTrackContext({
          [MprisMetadataKeys.TRACK_ID]: MPRIS_NO_TRACK_PATH,
          [MprisMetadataKeys.URL]: "https://example.test/stream",
          [MprisMetadataKeys.TITLE]: "Episode 1",
          [MprisMetadataKeys.ARTIST]: ["Artist"],
        });
        const enriched = resolvePlaybackPositionTrackContext({
          [MprisMetadataKeys.TRACK_ID]: MPRIS_NO_TRACK_PATH,
          [MprisMetadataKeys.URL]: "https://example.test/stream",
          [MprisMetadataKeys.TITLE]: "Episode 1",
          [MprisMetadataKeys.ARTIST]: ["Artist"],
          [MprisMetadataKeys.ALBUM]: "Later album",
          [MprisMetadataKeys.ART_URL]: "https://example.test/cover.jpg",
        });
        assert.match(first.identity, /^metadata:/);
        assert.equal(enriched.identity, first.identity);
        assert.equal(first.durationMicroseconds, null);
      },
    ],
  ]);
});
