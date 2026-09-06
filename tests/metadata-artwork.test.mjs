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
  ONLINE_ARTWORK_SEARCH_MAX_BYTES,
  ONLINE_ARTWORK_SEARCH_READ_CHUNK_BYTES,
  ONLINE_ARTWORK_SEARCH_TIMEOUT_SECONDS,
  ONLINE_ARTWORK_URL_CACHE_MAX_ENTRIES,
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
  const differentArtist = createAlbumArtRequest({
    ...first,
    metadata: {
      [MprisMetadataKeys.ART_URL]: first.albumArtUri,
      [MprisMetadataKeys.URL]: first.trackUri,
      [MprisMetadataKeys.ARTIST]: ["Different Artist"],
    },
  });

  assert.equal(first.key, equivalent.key);
  assert.notEqual(first.key, nextTrack.key);
  assert.notEqual(first.key, otherApp.key);
  assert.notEqual(first.key, highResToggled.key);
  assert.notEqual(first.key, differentTitle.key);
  assert.notEqual(first.key, differentArtist.key);
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
        assert.equal(ONLINE_ARTWORK_SEARCH_TIMEOUT_SECONDS, 3);
        assert.equal(ONLINE_ARTWORK_SEARCH_MAX_BYTES, 64 * 1024);
        assert.equal(ONLINE_ARTWORK_SEARCH_READ_CHUNK_BYTES, 8192);
        assert.equal(ONLINE_ARTWORK_URL_CACHE_MAX_ENTRIES, 100);
      },
    ],
  ]);
});

test("online artwork resolution utilities rewrite CDNs, sanitize titles, and parse search results", async () => {
  await runCases([
    [
      "browser bus name detection",
      () => {
        const cases = [
          ["org.mpris.MediaPlayer2.chromium.instance123", true],
          ["org.mpris.MediaPlayer2.firefox.instance456", true],
          ["org.mpris.MediaPlayer2.google-chrome.instance789", true],
          ["org.mpris.MediaPlayer2.brave.instance1", true],
          ["org.mpris.MediaPlayer2.edge.instance1", true],
          ["org.mpris.MediaPlayer2.microsoft-edge.instance2", true],
          ["org.mpris.MediaPlayer2.opera.instance1", true],
          ["org.mpris.MediaPlayer2.vivaldi.instance1", true],
          ["org.mpris.MediaPlayer2.zen.instance1", true],
          ["org.mpris.MediaPlayer2.Amberol", false],
          ["org.mpris.MediaPlayer2.spotify", false],
          ["", false],
          [null, false],
          [undefined, false],
          [123, false],
        ];
        for (const [busName, expected] of cases) {
          assert.equal(
            isBrowserBusName(busName),
            expected,
            `failed for bus name: ${busName}`,
          );
        }
      },
    ],
    [
      "temporary thumbnail URI detection",
      () => {
        const cases = [
          ["file:///tmp/.org.chromium.Chromium.abc123", true],
          ["file:///var/tmp/thumb.png", true],
          ["file:///home/user/Music/cover.jpg", false],
          ["https://example.com/cover.jpg", false],
          ["", false],
          [null, false],
          [undefined, false],
          [456, false],
        ];
        for (const [uri, expected] of cases) {
          assert.equal(
            isTempThumbnailUri(uri),
            expected,
            `failed for URI: ${uri}`,
          );
        }
      },
    ],
    [
      "CDN artwork URL rewriting",
      () => {
        const cases = [
          // YouTube Music / Google UserContent
          [
            "Google UserContent w60-h60",
            "https://lh3.googleusercontent.com/abc=w60-h60-l90-rj",
            "https://lh3.googleusercontent.com/abc=w800-h800-l90-rj",
          ],
          [
            "Google UserContent s120-c",
            "https://lh3.googleusercontent.com/abc=s120-c",
            "https://lh3.googleusercontent.com/abc=w800-h800-l90-rj",
          ],
          [
            "Google UserContent with query params",
            "https://lh3.googleusercontent.com/abc=s120-c?authuser=0",
            "https://lh3.googleusercontent.com/abc=w800-h800-l90-rj?authuser=0",
          ],
          [
            "YouTube hqdefault thumbnail",
            "https://i.ytimg.com/vi/xyz123/hqdefault.jpg",
            "https://i.ytimg.com/vi/xyz123/maxresdefault.jpg",
          ],
          [
            "YouTube mqdefault thumbnail",
            "https://i.ytimg.com/vi/xyz123/mqdefault.jpg",
            "https://i.ytimg.com/vi/xyz123/maxresdefault.jpg",
          ],
          [
            "YouTube thumbnail with query params",
            "https://i.ytimg.com/vi/xyz123/hqdefault.jpg?sqp=abc",
            "https://i.ytimg.com/vi/xyz123/maxresdefault.jpg?sqp=abc",
          ],
          // Spotify
          [
            "Spotify 64x64 (4851)",
            "https://i.scdn.co/image/ab67616d00004851abcdef0123456789abcdef01",
            "https://i.scdn.co/image/ab67616d0000b273abcdef0123456789abcdef01",
          ],
          [
            "Spotify 300x300 (1e02)",
            "https://i.scdn.co/image/ab67616d00001e02abcdef0123456789abcdef01",
            "https://i.scdn.co/image/ab67616d0000b273abcdef0123456789abcdef01",
          ],
          // SoundCloud
          [
            "SoundCloud large",
            "https://i1.sndcdn.com/artworks-000123456789-abcdef-large.jpg",
            "https://i1.sndcdn.com/artworks-000123456789-abcdef-t500x500.jpg",
          ],
          [
            "SoundCloud t300x300",
            "https://i1.sndcdn.com/artworks-000123456789-abcdef-t300x300.jpg",
            "https://i1.sndcdn.com/artworks-000123456789-abcdef-t500x500.jpg",
          ],
          // Bandcamp
          [
            "Bandcamp _7 size",
            "https://f4.bcbits.com/img/a1234567890_7.jpg",
            "https://f4.bcbits.com/img/a1234567890_10.jpg",
          ],
          [
            "Bandcamp _16 size",
            "https://f4.bcbits.com/img/a1234567890_16.jpg",
            "https://f4.bcbits.com/img/a1234567890_10.jpg",
          ],
          // Passthrough / Unrecognized / Non-HTTP
          [
            "Bandcamp already full size (_10)",
            "https://f4.bcbits.com/img/a1234567890_10.jpg",
            "https://f4.bcbits.com/img/a1234567890_10.jpg",
          ],
          [
            "Regular HTTP artwork URL",
            "https://example.com/regular_cover.jpg",
            "https://example.com/regular_cover.jpg",
          ],
          [
            "Local file URI ignored",
            "file:///tmp/cover.jpg",
            "file:///tmp/cover.jpg",
          ],
          ["Empty string", "", ""],
          ["Null input", null, null],
          ["Undefined input", undefined, undefined],
        ];
        for (const [label, input, expected] of cases) {
          assert.equal(
            rewriteCdnArtworkUrl(input),
            expected,
            `failed for ${label}`,
          );
        }
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
        assert.equal(cleanTrackTitleForSearch("(Official Music Video)"), "");
        assert.equal(cleanTrackTitleForSearch(""), "");
        assert.equal(cleanTrackTitleForSearch(null), "");
        assert.equal(cleanTrackTitleForSearch(undefined), "");

        // Search URL construction with artist and title
        assert.equal(
          buildOnlineArtworkSearchUrl(
            "Never Gonna Give You Up (Official Video)",
            "Rick Astley",
          ),
          "https://itunes.apple.com/search?term=Rick%20Astley%20Never%20Gonna%20Give%20You%20Up&entity=song&limit=1",
        );
        // Title only (no artist specified)
        assert.equal(
          buildOnlineArtworkSearchUrl("Song Title"),
          "https://itunes.apple.com/search?term=Song%20Title&entity=song&limit=1",
        );
        // Empty or noise-only titles return null
        assert.equal(buildOnlineArtworkSearchUrl(""), null);
        assert.equal(
          buildOnlineArtworkSearchUrl("(Official Music Video)"),
          null,
        );
        assert.equal(buildOnlineArtworkSearchUrl(null), null);
        assert.equal(buildOnlineArtworkSearchUrl(undefined), null);
      },
    ],
    [
      "iTunes search result high-res extraction",
      () => {
        // Standard artworkUrl100
        const payload100 = JSON.stringify({
          resultCount: 1,
          results: [
            {
              artworkUrl100:
                "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/ab/cd/ef/100x100bb.jpg",
            },
          ],
        });
        assert.equal(
          extractHighResArtworkUrlFromSearchResult(payload100),
          "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/ab/cd/ef/1000x1000bb.jpg",
        );

        // Fallback to artworkUrl60 when artworkUrl100 is absent
        const payload60 = JSON.stringify({
          resultCount: 1,
          results: [
            {
              artworkUrl60:
                "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/ab/cd/ef/60x60bb.jpg",
            },
          ],
        });
        assert.equal(
          extractHighResArtworkUrlFromSearchResult(payload60),
          "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/ab/cd/ef/1000x1000bb.jpg",
        );

        // Query parameters preservation
        const payloadWithQuery = JSON.stringify({
          resultCount: 1,
          results: [
            {
              artworkUrl100:
                "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/ab/cd/ef/100x100bb.jpg?uo=4",
            },
          ],
        });
        assert.equal(
          extractHighResArtworkUrlFromSearchResult(payloadWithQuery),
          "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/ab/cd/ef/1000x1000bb.jpg",
        );

        // Empty and invalid inputs
        assert.equal(
          extractHighResArtworkUrlFromSearchResult(
            JSON.stringify({ resultCount: 0, results: [] }),
          ),
          null,
        );
        assert.equal(
          extractHighResArtworkUrlFromSearchResult(
            JSON.stringify({ resultCount: 1, results: [{}] }),
          ),
          null,
        );
        assert.equal(
          extractHighResArtworkUrlFromSearchResult("invalid json"),
          null,
        );
        assert.equal(extractHighResArtworkUrlFromSearchResult(""), null);
        assert.equal(extractHighResArtworkUrlFromSearchResult("   "), null);
        assert.equal(extractHighResArtworkUrlFromSearchResult(null), null);
        assert.equal(extractHighResArtworkUrlFromSearchResult(undefined), null);
      },
    ],
  ]);
});
