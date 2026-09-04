/**
 * @file controls.js
 * @module shared.playback.controls
 *
 * Defines the canonical playback-control vocabulary shared by runtime surfaces.
 *
 * Each logical control owns one stable ID, actor name, semantic group, visual
 * role, and content kind. Popup and top bar render separate actors, but they consume
 * the same definitions so control identity and semantics cannot drift.
 */

/** Stable logical IDs used by state resolution, ordering, and execution. */
export const PlaybackControlIds = Object.freeze({
  SHUFFLE: "shuffle",
  SEEK_BACKWARD: "seek-backward",
  PREVIOUS: "previous",
  PLAY_PAUSE: "play-pause",
  NEXT: "next",
  SEEK_FORWARD: "seek-forward",
  REPEAT: "repeat",
  SPEED: "speed",
});

/** Content actor kinds used by the shared Shell content renderer. */
export const PlaybackControlContentKinds = Object.freeze({
  ICON: "icon",
  LABEL: "label",
});

/** Semantic control groups used by popup layout policy. */
export const PlaybackControlGroups = Object.freeze({
  TRANSPORT: "transport",
  SECONDARY: "secondary",
});

/** Fixed relative-seek interval shared by popup, top bar, keyboard, and mouse. */
export const RELATIVE_SEEK_SECONDS = 10;

/** Stable action IDs resolved by shared state and executed inside GNOME Shell. */
export const PlaybackControlActions = Object.freeze({
  TOGGLE_SHUFFLE: "toggle-shuffle",
  SEEK_BACKWARD: "seek-backward",
  PREVIOUS: "previous",
  PLAY: "play",
  PAUSE: "pause",
  PLAY_PAUSE: "play-pause",
  STOP: "stop",
  NEXT: "next",
  SEEK_FORWARD: "seek-forward",
  TOGGLE_REPEAT: "toggle-repeat",
  CYCLE_SPEED: "cycle-speed",
});

/**
 * Canonical definitions for every currently supported logical control.
 *
 * `actorName` preserves the existing St actor identity, while `id` is the
 * semantic key used by maps and order declarations. State-specific icon names
 * live inside the owning logical definition instead of masquerading as separate
 * controls.
 */
export const PlaybackControlDefinitions = Object.freeze({
  SHUFFLE: Object.freeze({
    id: PlaybackControlIds.SHUFFLE,
    actorName: "shuffle",
    contentKind: PlaybackControlContentKinds.ICON,
    group: PlaybackControlGroups.SECONDARY,
    isPrimary: false,
    isStateControl: true,
    icons: Object.freeze({
      OFF: "media-playlist-consecutive-symbolic",
      ON: "media-playlist-shuffle-symbolic",
    }),
  }),
  SEEK_BACKWARD: Object.freeze({
    id: PlaybackControlIds.SEEK_BACKWARD,
    actorName: "seekbackward",
    contentKind: PlaybackControlContentKinds.ICON,
    group: PlaybackControlGroups.TRANSPORT,
    isPrimary: false,
    isAdjacent: true,
    isStateControl: false,
    icons: Object.freeze({
      DEFAULT: "media-seek-backward-symbolic",
    }),
  }),
  PREVIOUS: Object.freeze({
    id: PlaybackControlIds.PREVIOUS,
    actorName: "previous",
    contentKind: PlaybackControlContentKinds.ICON,
    group: PlaybackControlGroups.TRANSPORT,
    isPrimary: false,
    isStateControl: false,
    icons: Object.freeze({
      DEFAULT: "media-skip-backward-symbolic",
    }),
  }),
  PLAY_PAUSE: Object.freeze({
    id: PlaybackControlIds.PLAY_PAUSE,
    actorName: "playpausestop",
    contentKind: PlaybackControlContentKinds.ICON,
    group: PlaybackControlGroups.TRANSPORT,
    isPrimary: true,
    isStateControl: false,
    icons: Object.freeze({
      PLAY: "media-playback-start-symbolic",
      PAUSE: "media-playback-pause-symbolic",
      STOP: "media-playback-stop-symbolic",
    }),
  }),
  NEXT: Object.freeze({
    id: PlaybackControlIds.NEXT,
    actorName: "next",
    contentKind: PlaybackControlContentKinds.ICON,
    group: PlaybackControlGroups.TRANSPORT,
    isPrimary: false,
    isStateControl: false,
    icons: Object.freeze({
      DEFAULT: "media-skip-forward-symbolic",
    }),
  }),
  SEEK_FORWARD: Object.freeze({
    id: PlaybackControlIds.SEEK_FORWARD,
    actorName: "seekforward",
    contentKind: PlaybackControlContentKinds.ICON,
    group: PlaybackControlGroups.TRANSPORT,
    isPrimary: false,
    isAdjacent: true,
    isStateControl: false,
    icons: Object.freeze({
      DEFAULT: "media-seek-forward-symbolic",
    }),
  }),
  REPEAT: Object.freeze({
    id: PlaybackControlIds.REPEAT,
    actorName: "loop",
    contentKind: PlaybackControlContentKinds.ICON,
    group: PlaybackControlGroups.SECONDARY,
    isPrimary: false,
    isStateControl: true,
    icons: Object.freeze({
      NONE: "media-playlist-repeat-symbolic",
      TRACK: "media-playlist-repeat-song-symbolic",
      PLAYLIST: "media-playlist-repeat-symbolic",
    }),
  }),
  SPEED: Object.freeze({
    id: PlaybackControlIds.SPEED,
    actorName: "speed",
    contentKind: PlaybackControlContentKinds.LABEL,
    group: PlaybackControlGroups.SECONDARY,
    isPrimary: false,
    isStateControl: false,
  }),
});

/** Canonical definitions as an ordered iterable for validation and tooling. */
export const PLAYBACK_CONTROL_DEFINITIONS = Object.freeze(
  Object.values(PlaybackControlDefinitions),
);
