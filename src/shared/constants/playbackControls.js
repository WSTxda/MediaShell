/**
 * @file playbackControls.js
 * @module shared.constants.playbackControls
 *
 * Defines canonical playback action descriptors for top bar and popup controls.
 *
 * Each descriptor exposes a stable `name` used as the actor-management key and
 * a themed symbolic icon name used by Shell UI renderers. Keeping these entries
 * shared prevents top bar and popup controls from drifting when an action changes
 * icon or actor identity.
 */

/**
 * Stable descriptors for every playback-control state rendered by MediaShell.
 *
 * Descriptors are shared by the top bar and popup, but each surface still owns
 * its own actor layout and sensitivity rules. The `name` values intentionally
 * collapse play, pause, and stop into one actor slot because only one primary
 * transport state can be visible at a time.
 */
export const PlaybackControls = Object.freeze({
  LOOP_NONE: Object.freeze({
    name: "loop",
    iconName: "media-playlist-repeat-symbolic",
  }),
  LOOP_TRACK: Object.freeze({
    name: "loop",
    iconName: "media-playlist-repeat-song-symbolic",
  }),
  LOOP_PLAYLIST: Object.freeze({
    name: "loop",
    iconName: "media-playlist-repeat-symbolic",
  }),
  PREVIOUS: Object.freeze({
    name: "previous",
    iconName: "media-skip-backward-symbolic",
  }),
  PLAY: Object.freeze({
    name: "playpausestop",
    iconName: "media-playback-start-symbolic",
  }),
  PAUSE: Object.freeze({
    name: "playpausestop",
    iconName: "media-playback-pause-symbolic",
  }),
  STOP: Object.freeze({
    name: "playpausestop",
    iconName: "media-playback-stop-symbolic",
  }),
  NEXT: Object.freeze({
    name: "next",
    iconName: "media-skip-forward-symbolic",
  }),
  SHUFFLE_ON: Object.freeze({
    name: "shuffle",
    iconName: "media-playlist-shuffle-symbolic",
  }),
  SHUFFLE_OFF: Object.freeze({
    name: "shuffle",
    iconName: "media-playlist-consecutive-symbolic",
  }),
});
