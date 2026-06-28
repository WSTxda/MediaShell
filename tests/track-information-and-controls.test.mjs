/**
 * @file track-information-and-controls.test.mjs
 * @module tests.trackInformationAndControls
 *
 * Tests shared track-information formatting and playback-control resolution.
 *
 * The suite ensures top-bar and popup components consume the same pure metadata
 * and transport-decision helpers while keeping Shell actor rendering untested in Node.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PlaybackControls } from "../src/shared/constants/playbackControls.js";
import { PlaybackStatus } from "../src/shared/enums/playback.js";
import { TrackInformationFields } from "../src/shared/enums/trackInformation.js";
import { buildTrackInformationText, readTrackInformation } from "../src/shared/utils/metadata.js";
import { resolvePlayPauseControl } from "../src/shared/utils/playbackControlState.js";

function mediaApp(state) {
  return {
    playbackStatus: PlaybackStatus.STOPPED,
    canControl: true,
    canPlay: true,
    canPause: true,
    ...state,
    playCalled: 0,
    pauseCalled: 0,
    stopCalled: 0,
    play() {
      this.playCalled++;
    },
    pause() {
      this.pauseCalled++;
    },
    stop() {
      this.stopCalled++;
    },
  };
}

test("track information normalization is shared by popup and top bar", () => {
  const metadata = {
    "xesam:title": "Track\nTitle",
    "xesam:artist": ["Artist A", "", "Artist B"],
    "xesam:album": "Album",
    "xesam:discNumber": 1,
    "xesam:trackNumber": 7,
  };

  assert.deepEqual(readTrackInformation(metadata, { unknownArtist: "Unknown artist", unknownAlbum: "Unknown album" }), {
    title: "Track\nTitle",
    artist: "Artist A, Artist B",
    album: "Album",
    discNumber: 1,
    trackNumber: 7,
  });

  assert.equal(
    buildTrackInformationText(
      metadata,
      ["TITLE", "ARTIST", "ALBUM", "DISC_NUMBER", "TRACK_NUMBER"],
      { unknownArtist: "Unknown artist", unknownAlbum: "Unknown album" },
    ),
    "Track Title Artist A, Artist B Album 1 7",
  );

  assert.equal(
    buildTrackInformationText({}, ["ARTIST", "ALBUM"], {
      unknownArtist: "Unknown artist",
      unknownAlbum: "Unknown album",
    }),
    "Unknown artist Unknown album",
  );
  assert.equal(TrackInformationFields.TITLE, "Title");
});

test("play pause control resolution keeps popup and top bar transport state aligned", () => {
  const stopped = mediaApp({ playbackStatus: PlaybackStatus.STOPPED, canPlay: true });
  const playControl = resolvePlayPauseControl(stopped);
  assert.equal(playControl.control, PlaybackControls.PLAY);
  assert.equal(playControl.isReactive, true);
  playControl.action();
  assert.equal(stopped.playCalled, 1);

  const playing = mediaApp({ playbackStatus: PlaybackStatus.PLAYING, canPause: true });
  const pauseControl = resolvePlayPauseControl(playing);
  assert.equal(pauseControl.control, PlaybackControls.PAUSE);
  pauseControl.action();
  assert.equal(playing.pauseCalled, 1);

  const unpausable = mediaApp({ playbackStatus: PlaybackStatus.PLAYING, canPause: false });
  const stopControl = resolvePlayPauseControl(unpausable);
  assert.equal(stopControl.control, PlaybackControls.STOP);
  stopControl.action();
  assert.equal(unpausable.stopCalled, 1);
});
