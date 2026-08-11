/**
 * @file metadata-artwork.test.mjs
 * @module tests.metadataArtwork
 *
 * Protects canonical MPRIS metadata and immutable, bounded album-art policy.
 * The suite rejects malformed display data, stale request identity, and unbounded cache policy.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { MprisMetadataKeys } from "../src/shared/constants/mpris.js";
import {
  ALBUM_ART_CACHE_MAX_BYTES,
  ALBUM_ART_MAX_BYTES,
} from "../src/shell/constants/albumArt.js";
import { normalizeAppIdentityHint } from "../src/shared/utils/appIdentity.js";
import {
  calculateAlbumArtCornerRadius,
  createAlbumArtRequest,
  selectAlbumArtCacheEvictions,
} from "../src/shared/utils/albumArt.js";
import {
  buildTrackInformationText,
  createMprisMetadataRevision,
  formatArtistNames,
  normalizeMetadataDisplayText,
  normalizeMprisMetadata,
} from "../src/shared/utils/metadata.js";
import { runCases } from "./helpers.mjs";

test("metadata normalization produces one stable and display-safe domain shape", async () => {
  await runCases([
    [
      "identity",
      () => {
        assert.equal(normalizeAppIdentityHint({ name: "bad" }), "");
        assert.equal(
          normalizeAppIdentityHint("  Player\nName\t "),
          "Player Name",
        );
      },
    ],
    [
      "known and unknown fields",
      () => {
        const metadata = normalizeMprisMetadata({
          [MprisMetadataKeys.TRACK_ID]: "  /org/example/Track/1  ",
          [MprisMetadataKeys.LENGTH]: "180000000",
          [MprisMetadataKeys.TITLE]: "  Track  ",
          [MprisMetadataKeys.ARTIST]: [" Artist A ", null, {}, "", "Artist B"],
          [MprisMetadataKeys.ALBUM_ARTIST]: "Album Artist",
          [MprisMetadataKeys.TRACK_NUMBER]: 3,
          [MprisMetadataKeys.DISC_NUMBER]: null,
          "vendor:extension": "kept",
        });
        assert.deepEqual(metadata, {
          [MprisMetadataKeys.TRACK_ID]: "/org/example/Track/1",
          [MprisMetadataKeys.LENGTH]: 180_000_000,
          [MprisMetadataKeys.TITLE]: "Track",
          [MprisMetadataKeys.ARTIST]: ["Artist A", "Artist B"],
          [MprisMetadataKeys.ALBUM_ARTIST]: ["Album Artist"],
          [MprisMetadataKeys.TRACK_NUMBER]: 3,
          "vendor:extension": "kept",
        });
        assert.deepEqual(normalizeMprisMetadata([]), {});
      },
    ],
    [
      "display",
      () => {
        assert.equal(normalizeMetadataDisplayText({ title: "bad" }), "");
        assert.equal(
          normalizeMetadataDisplayText("<b>Track</b>\nName"),
          "Track Name",
        );
        assert.equal(
          formatArtistNames(["Artist A", "", null, "Artist B"]),
          "Artist A, Artist B",
        );
        assert.equal(
          buildTrackInformationText(
            {
              [MprisMetadataKeys.TITLE]: { title: "bad" },
              [MprisMetadataKeys.ARTIST]: ["Artist", {}, null],
            },
            ["TITLE", "ARTIST"],
          ),
          "Artist",
        );
      },
    ],
    [
      "revision",
      () => {
        const first = normalizeMprisMetadata({
          [MprisMetadataKeys.TITLE]: " Track ",
          [MprisMetadataKeys.ARTIST]: "Artist",
          "vendor:ignored": "first",
        });
        const equivalent = normalizeMprisMetadata({
          [MprisMetadataKeys.TITLE]: "Track",
          [MprisMetadataKeys.ARTIST]: ["Artist"],
          "vendor:ignored": "second",
        });
        assert.equal(
          createMprisMetadataRevision(first),
          createMprisMetadataRevision(equivalent),
        );
        assert.notEqual(
          createMprisMetadataRevision(first),
          createMprisMetadataRevision({
            ...equivalent,
            [MprisMetadataKeys.ART_URL]: "https://example.test/cover.jpg",
          }),
        );
      },
    ],
  ]);
});

test("album-art corner radius scales consistently across artwork sizes", () => {
  assert.equal(calculateAlbumArtCornerRadius(20, 0), 0);
  assert.equal(calculateAlbumArtCornerRadius(20, 20), 2);
  assert.equal(calculateAlbumArtCornerRadius(20, 100), 10);
  assert.equal(calculateAlbumArtCornerRadius(250, 20), 25);
  assert.equal(calculateAlbumArtCornerRadius(250, 100), 125);
});

test("album-art requests separate source identity from presentation geometry", () => {
  const first = createAlbumArtRequest({
    busName: "org.mpris.MediaPlayer2.first",
    metadata: {
      [MprisMetadataKeys.ART_URL]: " https://example.test/cover.jpg ",
      [MprisMetadataKeys.URL]: "file:///music/track.ogg",
    },
    width: 250.4,
    radius: 400,
    cacheEnabled: true,
  });
  const equivalent = createAlbumArtRequest({
    busName: "org.mpris.MediaPlayer2.first",
    metadata: {
      [MprisMetadataKeys.ART_URL]: "https://example.test/cover.jpg",
      [MprisMetadataKeys.URL]: "file:///music/track.ogg",
    },
    width: 250,
    radius: 125,
    cacheEnabled: true,
  });
  const differentGeometry = createAlbumArtRequest({
    ...first,
    width: 64,
    radius: 0,
    metadata: {
      [MprisMetadataKeys.ART_URL]: first.albumArtUri,
      [MprisMetadataKeys.URL]: first.trackUri,
    },
  });
  const cacheDisabled = createAlbumArtRequest({
    ...first,
    cacheEnabled: false,
    metadata: {
      [MprisMetadataKeys.ART_URL]: first.albumArtUri,
      [MprisMetadataKeys.URL]: first.trackUri,
    },
  });
  const nextTrack = createAlbumArtRequest({
    ...first,
    metadata: {
      [MprisMetadataKeys.ART_URL]: first.albumArtUri,
      [MprisMetadataKeys.URL]: "file:///music/next.ogg",
    },
  });
  const otherApp = createAlbumArtRequest({
    ...first,
    busName: "org.mpris.MediaPlayer2.second",
    metadata: {
      [MprisMetadataKeys.ART_URL]: first.albumArtUri,
      [MprisMetadataKeys.URL]: first.trackUri,
    },
  });

  assert.equal(first.sourceKey, equivalent.sourceKey);
  assert.equal(first.sourceKey, differentGeometry.sourceKey);
  assert.notEqual(first.sourceKey, cacheDisabled.sourceKey);
  assert.notEqual(first.sourceKey, nextTrack.sourceKey);
  assert.notEqual(first.sourceKey, otherApp.sourceKey);
  assert.equal(first.radius, 125);
  assert.equal(Object.isFrozen(first), true);
});

test("album-art cache and payload limits remain deterministic and bounded", async () => {
  await runCases([
    [
      "byte-only eviction",
      () => {
        const entries = [
          { name: "new", sizeBytes: 40, modifiedSeconds: 30 },
          { name: "oldest", sizeBytes: 40, modifiedSeconds: 10 },
          { name: "middle", sizeBytes: 40, modifiedSeconds: 20 },
        ];
        assert.deepEqual(selectAlbumArtCacheEvictions(entries, 120), []);
        assert.deepEqual(selectAlbumArtCacheEvictions(entries, 80), ["oldest"]);
        assert.deepEqual(selectAlbumArtCacheEvictions(entries, 50), [
          "oldest",
          "middle",
        ]);
      },
    ],
    [
      "microsecond LRU recency",
      () => {
        assert.deepEqual(
          selectAlbumArtCacheEvictions(
            [
              {
                name: "recent",
                sizeBytes: 1,
                modifiedSeconds: 10,
                modifiedMicroseconds: 900,
              },
              {
                name: "older",
                sizeBytes: 1,
                modifiedSeconds: 10,
                modifiedMicroseconds: 100,
              },
            ],
            1,
          ),
          ["older"],
        );
      },
    ],
    [
      "invalid recency falls back safely",
      () => {
        assert.deepEqual(
          selectAlbumArtCacheEvictions(
            [
              {
                name: "invalid",
                sizeBytes: 1,
                modifiedSeconds: Number.POSITIVE_INFINITY,
                modifiedMicroseconds: Number.NaN,
              },
              { name: "valid", sizeBytes: 1, modifiedSeconds: 1 },
            ],
            1,
          ),
          ["invalid"],
        );
      },
    ],
    [
      "stable tie break",
      () => {
        assert.deepEqual(
          selectAlbumArtCacheEvictions(
            [
              { name: "b", sizeBytes: 1, modifiedSeconds: 1 },
              { name: "a", sizeBytes: 1, modifiedSeconds: 1 },
            ],
            1,
          ),
          ["a"],
        );
      },
    ],
    [
      "global limits",
      () => {
        assert.equal(ALBUM_ART_MAX_BYTES, 16 * 1024 * 1024);
        assert.equal(ALBUM_ART_CACHE_MAX_BYTES, 128 * 1024 * 1024);
      },
    ],
  ]);
});
