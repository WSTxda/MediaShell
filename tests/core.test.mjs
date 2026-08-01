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
} from "../src/shared/constants/platform.js";
import { isVersionAtLeast } from "../src/shared/utils/version.js";
import {
  TOP_BAR_VISUALIZER_BAND_COUNT,
  TOP_BAR_VISUALIZER_CLASSIC_COLUMN_COUNT,
  TOP_BAR_VISUALIZER_SPECTRUM_POINT_COUNT,
} from "../src/shared/constants/visualizer.js";
import {
  VisualizerAnimationKinds,
  VisualizerSpectrumLayers,
  VisualizerStyles,
} from "../src/shared/enums/visualizer.js";
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
import { arraysEqual, moveArrayItem } from "../src/shared/utils/collections.js";
import {
  enumValueByIndex,
  formatDurationMilliseconds,
  normalizeOrderedValues,
  normalizeUniqueStrings,
} from "../src/shared/utils/format.js";
import { createLogger } from "../src/shared/utils/log.js";
import { normalizeTrackInformationContent } from "../src/shared/utils/trackInformation.js";
import {
  buildSearchIndex,
  matchesSearchText,
  matchesSearchTokens,
  normalizeSearchText,
  tokenizeSearchQuery,
} from "../src/shared/utils/search.js";
import {
  getVisualizerLevels,
  getVisualizerSpectrumOffsets,
  normalizeVisualizerSpeed,
  normalizeVisualizerStyle,
} from "../src/shared/utils/visualizer.js";
import {
  TOP_BAR_VISUALIZER_STYLE_DEFINITIONS,
  VisualizerRendererKinds,
} from "../src/shell/constants/visualizer.js";
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
        assert.equal(arraysEqual(values, ["second", "third", "first"]), true);
        assert.equal(arraysEqual(values, ["second", "first", "third"]), false);
        const fallback = ["TITLE", "ARTIST"];
        assert.deepEqual(
          normalizeTrackInformationContent([" TITLE ", "", "TITLE"], fallback),
          ["TITLE", "TITLE"],
        );
        assert.equal(normalizeTrackInformationContent([], fallback), fallback);
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
        const assertFramesClose = (actual, expected) => {
          assert.equal(actual.length, expected.length);
          for (let index = 0; index < actual.length; index++)
            assert.ok(Math.abs(actual[index] - expected[index]) < 1e-12);
        };

        assert.equal(normalizeVisualizerSpeed(undefined), 4);
        assert.equal(normalizeVisualizerSpeed(0), 1);
        assert.equal(normalizeVisualizerSpeed(11), 8);
        assert.equal(normalizeVisualizerStyle(-1), VisualizerStyles.BEATS);
        assert.equal(
          normalizeVisualizerStyle(VisualizerStyles.SPECTRUM),
          VisualizerStyles.SPECTRUM,
        );

        const rendererKinds = new Set(Object.values(VisualizerRendererKinds));
        for (const style of Object.values(VisualizerStyles)) {
          const definition = TOP_BAR_VISUALIZER_STYLE_DEFINITIONS[style];
          assert.ok(definition);
          assert.ok(rendererKinds.has(definition.rendererKind));
        }
        assert.equal(
          TOP_BAR_VISUALIZER_STYLE_DEFINITIONS[VisualizerStyles.CLASSIC]
            .animationKind,
          VisualizerAnimationKinds.BEATS,
        );
        assert.equal(
          TOP_BAR_VISUALIZER_STYLE_DEFINITIONS[VisualizerStyles.CLASSIC]
            .elementCount,
          TOP_BAR_VISUALIZER_CLASSIC_COLUMN_COUNT,
        );

        const reusableLevels = new Array(TOP_BAR_VISUALIZER_BAND_COUNT);
        const beats = getVisualizerLevels(
          VisualizerAnimationKinds.BEATS,
          0.37,
          4,
          reusableLevels,
        );
        assert.equal(beats, reusableLevels);
        assertFramesClose(
          beats,
          [
            0.9940437304619096, 0.6466194424288516, 0.21672268377811832,
            0.421153203411492,
          ],
        );
        assertFramesClose(
          getVisualizerLevels(VisualizerAnimationKinds.PULSE, 0.37),
          [
            0.7941959066656921, 0.2506807791258749, 0.25565841237106834,
            0.7119127027050491,
          ],
        );
        assertFramesClose(
          getVisualizerLevels(VisualizerAnimationKinds.BEATS, 0.37, 8),
          getVisualizerLevels(VisualizerAnimationKinds.BEATS, 0.74, 4),
        );

        assert.equal(
          TOP_BAR_VISUALIZER_CLASSIC_COLUMN_COUNT,
          TOP_BAR_VISUALIZER_BAND_COUNT,
        );
        const reusableClassic = new Array(
          TOP_BAR_VISUALIZER_CLASSIC_COLUMN_COUNT,
        );
        const classic = getVisualizerLevels(
          TOP_BAR_VISUALIZER_STYLE_DEFINITIONS[VisualizerStyles.CLASSIC]
            .animationKind,
          0.37,
          4,
          reusableClassic,
        );
        assert.equal(classic, reusableClassic);
        assertFramesClose(classic, beats);

        const primaryOffsets = new Array(
          TOP_BAR_VISUALIZER_SPECTRUM_POINT_COUNT,
        );
        const secondaryOffsets = new Array(
          TOP_BAR_VISUALIZER_SPECTRUM_POINT_COUNT,
        );
        const spectrum = getVisualizerSpectrumOffsets(
          0.37,
          4,
          primaryOffsets,
          VisualizerSpectrumLayers.PRIMARY,
        );
        const backgroundSpectrum = getVisualizerSpectrumOffsets(
          0.37,
          4,
          secondaryOffsets,
          VisualizerSpectrumLayers.SECONDARY,
        );
        assert.equal(spectrum, primaryOffsets);
        assert.equal(backgroundSpectrum, secondaryOffsets);
        assert.equal(spectrum[0], 0);
        assert.equal(spectrum.at(-1), 0);
        assert.equal(backgroundSpectrum[0], 0);
        assert.equal(backgroundSpectrum.at(-1), 0);
        assert.ok(spectrum.every((value) => value >= -1 && value <= 1));
        assert.ok(
          backgroundSpectrum.every((value) => value >= -1 && value <= 1),
        );
        assert.notDeepEqual(spectrum, backgroundSpectrum);
        assertFramesClose(
          spectrum,
          [
            0, 0.0828838211401352, 0.12139517572341482, -0.1583710714856252,
            -0.4868807978633519, -0.1815450803234218, 0.3134342250893718,
            0.24625270125663265, 0.018602146726204, -0.01266542187049441, 0,
          ],
        );
        assertFramesClose(
          backgroundSpectrum,
          [
            0, 0.09819040083206695, 0.20699474856130515, 0.12837587515764975,
            -0.20147313906095343, -0.512974641095604, -0.5663165690880586,
            -0.2961804848033074, 0.07943234869022717, 0.1616213657084673, 0,
          ],
        );
        assertFramesClose(
          getVisualizerSpectrumOffsets(0.37, 8),
          getVisualizerSpectrumOffsets(0.74, 4),
        );
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
