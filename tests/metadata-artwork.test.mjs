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
import {
  buildOnlineArtworkSearchUrl,
  cleanTrackTitleForSearch,
  extractHighResArtworkUrlFromSearchResult,
  isBrowserBusName,
  isTempThumbnailUri,
  rewriteCdnArtworkUrl,
} from "../src/shared/utils/onlineArtwork.js";
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

test("album-art requests snapshot ownership and reject stale-equivalent ambiguity", () => {
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

  const highResToggled = createAlbumArtRequest({
    ...first,
    metadata: {
      [MprisMetadataKeys.ART_URL]: first.albumArtUri,
      [MprisMetadataKeys.URL]: first.trackUri,
    },
    fetchHighRes: true,
  });
  const differentTitle = createAlbumArtRequest({
    ...first,
    metadata: {
      [MprisMetadataKeys.ART_URL]: first.albumArtUri,
      [MprisMetadataKeys.URL]: first.trackUri,
      [MprisMetadataKeys.TITLE]: "New Song",
    },
  });

  assert.equal(first.key, equivalent.key);
  assert.notEqual(first.key, nextTrack.key);
  assert.notEqual(first.key, otherApp.key);
  assert.notEqual(first.key, highResToggled.key);
  assert.notEqual(first.key, differentTitle.key);
  assert.equal(first.radius, 125);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.fetchHighRes, false);
  assert.equal(highResToggled.fetchHighRes, true);
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

test("online artwork resolution utilities rewrite CDNs, sanitize titles, and parse search results", async () => {
  await runCases([
    [
      "bus name and temp thumbnail detection",
      () => {
        assert.equal(
          isBrowserBusName("org.mpris.MediaPlayer2.chromium.instance123"),
          true,
        );
        assert.equal(
          isBrowserBusName("org.mpris.MediaPlayer2.firefox.instance456"),
          true,
        );
        assert.equal(
          isBrowserBusName("org.mpris.MediaPlayer2.google-chrome.instance789"),
          true,
        );
        assert.equal(
          isBrowserBusName("org.mpris.MediaPlayer2.brave.instance1"),
          true,
        );
        assert.equal(isBrowserBusName("org.mpris.MediaPlayer2.Amberol"), false);
        assert.equal(isBrowserBusName("org.mpris.MediaPlayer2.spotify"), false);
        assert.equal(isBrowserBusName(""), false);

        assert.equal(
          isTempThumbnailUri("file:///tmp/.org.chromium.Chromium.abc123"),
          true,
        );
        assert.equal(isTempThumbnailUri("file:///var/tmp/thumb.png"), true);
        assert.equal(
          isTempThumbnailUri("file:///home/user/Music/cover.jpg"),
          false,
        );
        assert.equal(
          isTempThumbnailUri("https://example.com/cover.jpg"),
          false,
        );
      },
    ],
    [
      "CDN artwork URL rewriting",
      () => {
        // YouTube Music / Google UserContent
        assert.equal(
          rewriteCdnArtworkUrl(
            "https://lh3.googleusercontent.com/abc=w60-h60-l90-rj",
          ),
          "https://lh3.googleusercontent.com/abc=w800-h800-l90-rj",
        );
        assert.equal(
          rewriteCdnArtworkUrl("https://lh3.googleusercontent.com/abc=s120-c"),
          "https://lh3.googleusercontent.com/abc=w800-h800-l90-rj",
        );
        assert.equal(
          rewriteCdnArtworkUrl("https://i.ytimg.com/vi/xyz123/hqdefault.jpg"),
          "https://i.ytimg.com/vi/xyz123/maxresdefault.jpg",
        );
        // Spotify
        assert.equal(
          rewriteCdnArtworkUrl(
            "https://i.scdn.co/image/ab67616d00004851abcdef0123456789abcdef01",
          ),
          "https://i.scdn.co/image/ab67616d0000b273abcdef0123456789abcdef01",
        );
        assert.equal(
          rewriteCdnArtworkUrl(
            "https://i.scdn.co/image/ab67616d00001e02abcdef0123456789abcdef01",
          ),
          "https://i.scdn.co/image/ab67616d0000b273abcdef0123456789abcdef01",
        );
        // SoundCloud
        assert.equal(
          rewriteCdnArtworkUrl(
            "https://i1.sndcdn.com/artworks-000123456789-abcdef-large.jpg",
          ),
          "https://i1.sndcdn.com/artworks-000123456789-abcdef-t500x500.jpg",
        );
        // Bandcamp
        assert.equal(
          rewriteCdnArtworkUrl("https://f4.bcbits.com/img/a1234567890_7.jpg"),
          "https://f4.bcbits.com/img/a1234567890_10.jpg",
        );
        // Unrecognized or already high-res
        assert.equal(
          rewriteCdnArtworkUrl("https://f4.bcbits.com/img/a1234567890_10.jpg"),
          "https://f4.bcbits.com/img/a1234567890_10.jpg",
        );
        assert.equal(
          rewriteCdnArtworkUrl("https://example.com/regular_cover.jpg"),
          "https://example.com/regular_cover.jpg",
        );
      },
    ],
    [
      "track title cleaning and search URL building",
      () => {
        assert.equal(
          cleanTrackTitleForSearch(
            "Never Gonna Give You Up (Official Music Video)",
            "Rick Astley",
          ),
          "Never Gonna Give You Up",
        );
        assert.equal(
          cleanTrackTitleForSearch(
            "Rick Astley - Never Gonna Give You Up [Official Audio]",
            "Rick Astley",
          ),
          "Never Gonna Give You Up",
        );
        assert.equal(
          cleanTrackTitleForSearch(
            "Song Title (feat. Featured Artist) (Lyric Video)",
          ),
          "Song Title",
        );
        assert.equal(
          buildOnlineArtworkSearchUrl(
            "Never Gonna Give You Up (Official Video)",
            "Rick Astley",
          ),
          "https://itunes.apple.com/search?term=Rick%20Astley%20Never%20Gonna%20Give%20You%20Up&entity=song&limit=1",
        );
        assert.equal(buildOnlineArtworkSearchUrl(""), null);
      },
    ],
    [
      "iTunes search result high-res extraction",
      () => {
        const payload = JSON.stringify({
          resultCount: 1,
          results: [
            {
              artworkUrl100:
                "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/ab/cd/ef/100x100bb.jpg",
            },
          ],
        });
        assert.equal(
          extractHighResArtworkUrlFromSearchResult(payload),
          "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/ab/cd/ef/1000x1000bb.jpg",
        );
        assert.equal(
          extractHighResArtworkUrlFromSearchResult(
            JSON.stringify({ resultCount: 0, results: [] }),
          ),
          null,
        );
        assert.equal(
          extractHighResArtworkUrlFromSearchResult("invalid json"),
          null,
        );
        assert.equal(extractHighResArtworkUrlFromSearchResult(""), null);
      },
    ],
  ]);
});
