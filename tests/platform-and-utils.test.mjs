/**
 * @file platform-and-utils.test.mjs
 * @module tests.platformAndUtils
 *
 * Tests platform constants and pure utility helpers shared by runtime and preferences code.
 *
 * The suite guards GNOME version helpers, formatting utilities, search indexing,
 * app identity normalization, visualizer generation, and shared UI-state constants
 * without loading GNOME libraries.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MINIMUM_LIBADWAITA_VERSION,
  SUPPORTED_GNOME_SHELL_VERSIONS,
  isVersionAtLeast,
} from "../src/shared/constants/platform.js";
import {
  buildAppLookupHints,
  buildDesktopAppIdCandidates,
  normalizeAppIdentity,
  stripDesktopFileSuffix,
} from "../src/shared/utils/appIdentity.js";
import {
  enumValueByIndex,
  formatDurationMilliseconds,
  normalizeOrderedValues,
  normalizeUniqueStrings,
} from "../src/shared/utils/format.js";
import { formatArtistNames } from "../src/shared/utils/metadata.js";
import {
  buildSearchIndex,
  matchesSearchText,
  matchesSearchTokens,
  normalizeSearchText,
  tokenizeSearchQuery,
} from "../src/shared/utils/search.js";
import {
  getVisualizerBarLevels,
  normalizeVisualizerSpeed,
  TOP_BAR_VISUALIZER_BAR_COUNT,
} from "../src/shared/utils/visualizer.js";
import { VisualizerStyles } from "../src/shared/enums/visualizer.js";

test("platform policy is the exact supported baseline", () => {
  assert.deepEqual(SUPPORTED_GNOME_SHELL_VERSIONS, ["47", "48", "49", "50"]);
  assert.deepEqual(MINIMUM_LIBADWAITA_VERSION, { major: 1, minor: 6 });
  assert.equal(isVersionAtLeast(1, 5), false);
  assert.equal(isVersionAtLeast(1, 6), true);
  assert.equal(isVersionAtLeast(1, 9), true);
  assert.equal(isVersionAtLeast(2, 0), true);
});

test("duration formatting handles minutes and hours", () => {
  assert.equal(formatDurationMilliseconds(0), "00:00");
  assert.equal(formatDurationMilliseconds(-1), "00:00");
  assert.equal(formatDurationMilliseconds(Number.NaN), "00:00");
  assert.equal(formatDurationMilliseconds(65_999), "01:05");
  assert.equal(formatDurationMilliseconds(3_661_000), "01:01:01");
  assert.equal(
    enumValueByIndex({ FIRST: "first", SECOND: "second" }, 1),
    "second",
  );
});

test("string-list normalization removes empty and duplicate persisted values", () => {
  assert.deepEqual(
    normalizeUniqueStrings([
      "app.desktop",
      "",
      " app.desktop ",
      null,
      "other.desktop",
    ]),
    ["app.desktop", "other.desktop"],
  );
  assert.deepEqual(normalizeUniqueStrings(null), []);
});

test("ordered setting values drop corruption, remove duplicates, and restore missing entries", () => {
  const allowed = [
    "APP_ICON",
    "TRACK_INFORMATION",
    "VISUALIZER",
    "PLAYBACK_CONTROLS",
  ];
  assert.deepEqual(
    normalizeOrderedValues(
      ["PLAYBACK_CONTROLS", "UNKNOWN", "APP_ICON", "APP_ICON"],
      allowed,
    ),
    ["PLAYBACK_CONTROLS", "APP_ICON", "TRACK_INFORMATION", "VISUALIZER"],
  );
  assert.deepEqual(normalizeOrderedValues(null, allowed), allowed);
});

test("MPRIS artist metadata is normalized without leaking invalid values", () => {
  assert.equal(
    formatArtistNames(["Artist A", "Artist B"]),
    "Artist A, Artist B",
  );
  assert.equal(formatArtistNames(["Artist A", "", null]), "Artist A");
  assert.equal(formatArtistNames("Artist A"), "Artist A");
  assert.equal(formatArtistNames("   ", "Unknown artist"), "Unknown artist");
  assert.equal(formatArtistNames(null, "Unknown artist"), "Unknown artist");
});

test("app identity normalization removes desktop suffixes and unstable bus segments", () => {
  assert.equal(
    stripDesktopFileSuffix("org.mozilla.firefox.desktop"),
    "org.mozilla.firefox",
  );
  assert.equal(
    normalizeAppIdentity("  Música—Player.desktop "),
    "musica player",
  );

  const hints = buildAppLookupHints(
    "Google Chrome",
    "com.google.Chrome.desktop",
    "org.mpris.MediaPlayer2.chromium.instance123",
  );
  assert.ok(hints.includes("com.google.Chrome"));
  assert.ok(hints.includes("google chrome"));
  assert.ok(hints.includes("chromium"));
  assert.equal(
    hints.some((hint) => hint === "instance123"),
    false,
  );

  const appIds = buildDesktopAppIdCandidates(
    "Firefox",
    "org.mozilla.firefox.desktop",
  );
  assert.ok(appIds.includes("org.mozilla.firefox"));
  assert.ok(appIds.includes("org.mozilla.firefox.desktop"));
});

test("installed-app search is case, accent, punctuation, and desktop-ID tolerant", () => {
  assert.equal(
    normalizeSearchText("  Google.Chrome—Beta.desktop  "),
    "google chrome beta desktop",
  );
  assert.equal(
    matchesSearchText("chrome", ["Google Chrome", "com.google.Chrome.desktop"]),
    true,
  );
  assert.equal(
    matchesSearchText("música", [
      "Musica Player",
      "org.example.Player.desktop",
    ]),
    true,
  );
  assert.equal(
    matchesSearchText("com google chrome", [
      "Google Chrome",
      "com.google.Chrome.desktop",
    ]),
    true,
  );
  assert.equal(
    matchesSearchText("chrome google", [
      "Google Chrome",
      "com.google.Chrome.desktop",
    ]),
    true,
  );
  assert.equal(
    matchesSearchText("firefox", [
      "Google Chrome",
      "com.google.Chrome.desktop",
    ]),
    false,
  );

  const searchIndex = buildSearchIndex([
    "Google Chrome",
    "com.google.Chrome.desktop",
  ]);
  assert.equal(searchIndex, "google chrome com google chrome desktop");
  assert.deepEqual(tokenizeSearchQuery("  Chrome—Google  "), [
    "chrome",
    "google",
  ]);
  assert.equal(matchesSearchTokens(["chrome", "google"], searchIndex), true);
  assert.equal(matchesSearchTokens(["firefox"], searchIndex), false);
});

test("visualizer styles produce bounded fixed-size levels", () => {
  assert.equal(normalizeVisualizerSpeed(undefined), 4);
  assert.equal(normalizeVisualizerSpeed(0), 1);
  assert.equal(normalizeVisualizerSpeed(11), 8);

  for (const style of [VisualizerStyles.WAVE, VisualizerStyles.PULSE]) {
    const firstFrame = getVisualizerBarLevels(style, 0);
    const laterFrame = getVisualizerBarLevels(style, 0.37);
    const slowFrame = getVisualizerBarLevels(style, 0.37, 1);
    const fastFrame = getVisualizerBarLevels(style, 0.37, 8);
    assert.equal(firstFrame.length, TOP_BAR_VISUALIZER_BAR_COUNT);
    assert.equal(laterFrame.length, TOP_BAR_VISUALIZER_BAR_COUNT);
    assert.ok(firstFrame.every((level) => level >= 0.2 && level <= 1));
    assert.ok(laterFrame.every((level) => level >= 0.2 && level <= 1));
    assert.notDeepEqual(firstFrame, laterFrame);
    assert.notDeepEqual(slowFrame, fastFrame);

    const reusableFrame = new Array(TOP_BAR_VISUALIZER_BAR_COUNT).fill(0);
    assert.equal(
      getVisualizerBarLevels(style, 0.5, 4, reusableFrame),
      reusableFrame,
    );
    assert.ok(reusableFrame.every((level) => level >= 0.2 && level <= 1));
  }
});

test("MPRIS values are normalized to specification-safe defaults", async () => {
  const { MPRIS_NO_TRACK_PATH } =
    await import("../src/shared/constants/dbus.js");
  const { MediaAppValidity } = await import("../src/shared/enums/app.js");
  const { LoopStatus, PlaybackStatus } =
    await import("../src/shared/enums/playback.js");
  const {
    metadataContainsTrack,
    normalizeLoopStatus,
    normalizePlaybackStatus,
    resolveMediaAppValidity,
  } = await import("../src/shared/utils/mpris.js");

  assert.equal(
    normalizePlaybackStatus(PlaybackStatus.PLAYING),
    PlaybackStatus.PLAYING,
  );
  assert.equal(normalizePlaybackStatus("Buffering"), PlaybackStatus.STOPPED);
  assert.equal(normalizeLoopStatus(LoopStatus.PLAYLIST), LoopStatus.PLAYLIST);
  assert.equal(normalizeLoopStatus("Invalid"), LoopStatus.NONE);
  assert.equal(
    metadataContainsTrack({
      "mpris:trackid": MPRIS_NO_TRACK_PATH,
      "xesam:title": "Stale",
    }),
    false,
  );
  assert.equal(
    metadataContainsTrack({ "mpris:trackid": "/org/example/track/1" }),
    true,
  );
  assert.equal(
    metadataContainsTrack({ "xesam:title": "Track without id" }),
    true,
  );
  assert.equal(metadataContainsTrack({}), false);

  assert.equal(
    resolveMediaAppValidity({
      hasIdentity: false,
      hasTrackMetadata: true,
      hasPresentedTrackMetadata: false,
      playbackStatus: PlaybackStatus.PLAYING,
    }),
    MediaAppValidity.INVALID,
  );
  assert.equal(
    resolveMediaAppValidity({
      hasIdentity: true,
      hasTrackMetadata: true,
      hasPresentedTrackMetadata: false,
      playbackStatus: PlaybackStatus.STOPPED,
    }),
    MediaAppValidity.VALID,
  );
  assert.equal(
    resolveMediaAppValidity({
      hasIdentity: true,
      hasTrackMetadata: false,
      hasPresentedTrackMetadata: false,
      playbackStatus: PlaybackStatus.PLAYING,
    }),
    MediaAppValidity.VALID,
  );
  assert.equal(
    resolveMediaAppValidity({
      hasIdentity: true,
      hasTrackMetadata: false,
      hasPresentedTrackMetadata: false,
      playbackStatus: PlaybackStatus.PAUSED,
    }),
    MediaAppValidity.VALID,
  );
  assert.equal(
    resolveMediaAppValidity({
      hasIdentity: true,
      hasTrackMetadata: false,
      hasPresentedTrackMetadata: false,
      playbackStatus: PlaybackStatus.STOPPED,
    }),
    MediaAppValidity.INVALID,
  );
  assert.equal(
    resolveMediaAppValidity({
      hasIdentity: true,
      hasTrackMetadata: false,
      hasPresentedTrackMetadata: true,
      playbackStatus: PlaybackStatus.STOPPED,
    }),
    MediaAppValidity.EMPTY_STOPPED_GRACE,
  );
});
