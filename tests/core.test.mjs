/**
 * @file core.test.mjs
 * @module tests.core
 *
 * Consolidates pure utility, platform, identity, search, visualizer, and logging contracts.
 * The suite covers GI-free behavior reused by Shell and Preferences.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MINIMUM_LIBADWAITA_VERSION,
  SUPPORTED_GNOME_SHELL_VERSIONS,
  isVersionAtLeast,
} from "../src/shared/constants/platform.js";
import { TOP_BAR_VISUALIZER_BAR_COUNT } from "../src/shared/constants/visualizer.js";
import { VisualizerStyles } from "../src/shared/enums/visualizer.js";
import {
  buildAppLookupHints,
  buildDesktopAppIdCandidates,
  normalizeAppIdentity,
  stripDesktopFileSuffix,
} from "../src/shared/utils/appIdentity.js";
import {
  buildBrowserIdentityAliases,
  extractChromiumPwaAppIds,
  isChromiumPwaAppId,
  resolveBrowserIdentityCandidate,
  scoreBrowserIdentityCandidate,
} from "../src/shared/utils/browserIdentity.js";
import { moveArrayItem } from "../src/shared/utils/collections.js";
import {
  enumValueByIndex,
  formatDurationMilliseconds,
  normalizeOrderedValues,
  normalizeUniqueStrings,
} from "../src/shared/utils/format.js";
import { createLogger } from "../src/shared/utils/log.js";
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
} from "../src/shared/utils/visualizer.js";
import { runCases } from "./helpers.mjs";

const PWA_ID = "cinhimbnkkaeohfgghhklpknlkffjgod";

test("core utilities preserve bounded, deterministic behavior", async () => {
  await runCases([
    [
      "platform",
      () => {
        assert.deepEqual(SUPPORTED_GNOME_SHELL_VERSIONS, [
          "47",
          "48",
          "49",
          "50",
        ]);
        assert.deepEqual(MINIMUM_LIBADWAITA_VERSION, { major: 1, minor: 6 });
        assert.equal(isVersionAtLeast(1, 5), false);
        assert.equal(isVersionAtLeast(1, 6), true);
        assert.equal(isVersionAtLeast(2, 0), true);
      },
    ],
    [
      "collections",
      () => {
        const values = ["first", "second", "third"];
        assert.equal(moveArrayItem(values, 0, 2), true);
        assert.deepEqual(values, ["second", "third", "first"]);
        assert.equal(moveArrayItem(values, 2, 0), true);
        assert.deepEqual(values, ["first", "second", "third"]);
        assert.equal(moveArrayItem(values, -1, 0), false);
        assert.equal(moveArrayItem(values, 0, 0), false);
      },
    ],
    [
      "formatting",
      () => {
        assert.equal(formatDurationMilliseconds(0), "00:00");
        assert.equal(formatDurationMilliseconds(65_999), "01:05");
        assert.equal(formatDurationMilliseconds(3_661_000), "01:01:01");
        assert.equal(
          enumValueByIndex({ FIRST: "first", SECOND: "second" }, 1),
          "second",
        );
        assert.deepEqual(normalizeUniqueStrings([" a ", "", "a", null, "b"]), [
          "a",
          "b",
        ]);
        assert.deepEqual(
          normalizeOrderedValues(["C", "UNKNOWN", "A", "A"], ["A", "B", "C"]),
          ["C", "A", "B"],
        );
      },
    ],
    [
      "visualizer",
      () => {
        assert.equal(normalizeVisualizerSpeed(undefined), 4);
        assert.equal(normalizeVisualizerSpeed(0), 1);
        assert.equal(normalizeVisualizerSpeed(11), 8);
        for (const style of [VisualizerStyles.BEATS, VisualizerStyles.PULSE]) {
          const frame = getVisualizerBarLevels(style, 0.37);
          assert.equal(frame.length, TOP_BAR_VISUALIZER_BAR_COUNT);
          assert.ok(frame.every((value) => value >= 0.2 && value <= 1));
        }
      },
    ],
    [
      "logging",
      () => {
        const original = {
          debug: console.debug,
          warn: console.warn,
          error: console.error,
        };
        const calls = [];
        for (const method of Object.keys(original))
          console[method] = (...args) => calls.push([method, args]);
        try {
          const logger = createLogger("CoreTest");
          logger.debugOnce("same", "first");
          logger.debugOnce("same", "duplicate");
          logger.warnOnce("same", "warning");
          assert.deepEqual(calls, [
            ["debug", ["[MediaShell][CoreTest]", "first"]],
            ["warn", ["[MediaShell][CoreTest]", "warning"]],
          ]);
        } finally {
          Object.assign(console, original);
        }
      },
    ],
  ]);
});

test("identity and search stay generic, normalized, and service-agnostic", async () => {
  await runCases([
    [
      "desktop identity",
      () => {
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
        assert.ok(hints.includes("chromium"));
        assert.equal(hints.includes("instance123"), false);
        assert.ok(
          buildDesktopAppIdCandidates(
            "Firefox",
            "org.mozilla.firefox.desktop",
          ).includes("org.mozilla.firefox"),
        );
      },
    ],
    [
      "browser PWA",
      () => {
        assert.equal(isChromiumPwaAppId(PWA_ID), true);
        assert.deepEqual(extractChromiumPwaAppIds(`helium-${PWA_ID}-Default`), [
          PWA_ID,
        ]);
        assert.deepEqual(
          buildBrowserIdentityAliases({
            desktopId: `helium-${PWA_ID}-Default.desktop`,
            startupWmClass: `crx_${PWA_ID}`,
          }),
          [PWA_ID, `crx_${PWA_ID}`],
        );
        const mediaIdentity = {
          identity: "Media app",
          desktopEntry: `chromium-${PWA_ID}-Default`,
          busName: "org.mpris.MediaPlayer2.chromium.instance123",
        };
        assert.deepEqual(
          scoreBrowserIdentityCandidate(mediaIdentity, {
            desktopId: `org.example.Browser-${PWA_ID}-Default.desktop`,
            displayName: "Media app",
          }),
          { score: 1000, reason: "desktopId", appId: PWA_ID },
        );
        assert.equal(
          resolveBrowserIdentityCandidate(mediaIdentity, [
            {
              desktopId: "org.mozilla.firefox.desktop",
              displayName: "Firefox",
            },
          ]),
          null,
        );
      },
    ],
    [
      "search",
      () => {
        assert.equal(
          normalizeSearchText(" Google.Chrome—Beta.desktop "),
          "google chrome beta desktop",
        );
        assert.equal(
          matchesSearchText("música", [
            "Musica Player",
            "org.example.Player.desktop",
          ]),
          true,
        );
        const index = buildSearchIndex([
          "Google Chrome",
          "com.google.Chrome.desktop",
        ]);
        assert.deepEqual(tokenizeSearchQuery(" Chrome—Google "), [
          "chrome",
          "google",
        ]);
        assert.equal(matchesSearchTokens(["chrome", "google"], index), true);
        assert.equal(matchesSearchTokens(["firefox"], index), false);
      },
    ],
  ]);
});
