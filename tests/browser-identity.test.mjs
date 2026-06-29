/**
 * @file browser-identity.test.mjs
 * @module tests.browserIdentity
 *
 * Tests browser/PWA identity helpers without importing GNOME libraries.
 *
 * The suite protects MediaShell's data-driven PWA matching from regressing into
 * hardcoded browser-prefix lists. Runtime resolvers can then improve icons,
 * blocked-app matching, and app focus for browser media apps without changing UI.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildAppLookupHints } from "../src/shared/utils/appIdentity.js";
import {
  buildBrowserIdentityAliases,
  extractChromiumPwaAppIds,
  isChromiumPwaAppId,
  resolveBrowserIdentityCandidate,
  scoreBrowserIdentityCandidate,
} from "../src/shared/utils/browserIdentity.js";

const YOUTUBE_MUSIC_ID = "cinhimbnkkaeohfgghhklpknlkffjgod";
const SPOTIFY_PWA_ID = "hnpfjngllnobngcgfapefoaidbinmjnm";

test("browser PWA identity matching stays generic and conservative", () => {
  assert.equal(isChromiumPwaAppId(YOUTUBE_MUSIC_ID), true);
  assert.equal(isChromiumPwaAppId(`${YOUTUBE_MUSIC_ID}x`), false);
  assert.deepEqual(extractChromiumPwaAppIds(`crx_${YOUTUBE_MUSIC_ID}`), [
    YOUTUBE_MUSIC_ID,
  ]);
  assert.deepEqual(
    extractChromiumPwaAppIds(`helium-${YOUTUBE_MUSIC_ID}-Default`),
    [YOUTUBE_MUSIC_ID],
  );
  assert.deepEqual(
    extractChromiumPwaAppIds(
      `com.example.Browser-${YOUTUBE_MUSIC_ID}-Profile_2.desktop`,
    ),
    [YOUTUBE_MUSIC_ID],
  );
  assert.deepEqual(
    extractChromiumPwaAppIds("brave-browser", "Google Chrome", "spotify"),
    [],
  );
  assert.deepEqual(
    extractChromiumPwaAppIds("crx_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"),
    [],
  );

  const aliases = buildBrowserIdentityAliases({
    desktopId: `helium-${YOUTUBE_MUSIC_ID}-Default.desktop`,
    displayName: "YouTube Music",
    startupWmClass: `crx_${YOUTUBE_MUSIC_ID}`,
  });

  assert.deepEqual(aliases, [YOUTUBE_MUSIC_ID, `crx_${YOUTUBE_MUSIC_ID}`]);

  const mediaIdentity = {
    identity: "YouTube Music",
    desktopEntry: `chromium-${YOUTUBE_MUSIC_ID}-Default`,
    busName: "org.mpris.MediaPlayer2.chromium.instance123",
  };

  assert.deepEqual(
    scoreBrowserIdentityCandidate(mediaIdentity, {
      desktopId: `org.example.Browser-${YOUTUBE_MUSIC_ID}-Default.desktop`,
      displayName: "YouTube Music",
    }),
    { score: 1000, reason: "desktopId", appId: YOUTUBE_MUSIC_ID },
  );

  assert.deepEqual(
    scoreBrowserIdentityCandidate(mediaIdentity, {
      desktopId: "org.example.Browser.desktop",
      startupWmClass: `crx_${YOUTUBE_MUSIC_ID}`,
      displayName: "Browser",
    }),
    { score: 950, reason: "startupWmClass", appId: YOUTUBE_MUSIC_ID },
  );

  const spotifyIdentity = {
    identity: "Spotify",
    desktopEntry: `chrome-${SPOTIFY_PWA_ID}-Default`,
  };

  assert.equal(
    resolveBrowserIdentityCandidate(spotifyIdentity, [
      { desktopId: "org.mozilla.firefox.desktop", displayName: "Firefox" },
      { desktopId: "com.google.Chrome.desktop", displayName: "Google Chrome" },
    ]),
    null,
  );

  const match = resolveBrowserIdentityCandidate(spotifyIdentity, [
    { desktopId: "com.google.Chrome.desktop", displayName: "Google Chrome" },
    {
      desktopId: `chromium-${SPOTIFY_PWA_ID}-Default.desktop`,
      displayName: "Spotify",
    },
  ]);

  assert.equal(
    match?.descriptor.desktopId,
    `chromium-${SPOTIFY_PWA_ID}-Default.desktop`,
  );
  assert.equal(match?.reason, "desktopId");

  const hints = buildAppLookupHints(
    "YouTube Music",
    `anybrowser-${YOUTUBE_MUSIC_ID}-Default.desktop`,
    "org.mpris.MediaPlayer2.chromium.instance123",
  );

  assert.ok(hints.includes(YOUTUBE_MUSIC_ID));
  assert.ok(hints.includes(`crx_${YOUTUBE_MUSIC_ID}`));
  assert.equal(hints.includes("anybrowser"), false);
});
