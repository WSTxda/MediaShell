/**
 * @file playback-controls.test.mjs
 * @module tests.playbackControls
 *
 * Consolidates playback definitions, state, surfaces, inputs, layout, and rate policy.
 * The suite verifies one domain shared by popup, top bar, keyboard, and pointer inputs.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  INPUT_ACTION_DEFINITIONS,
  MOUSE_ACTION_VALUES,
  PLAYBACK_ACTION_BY_INPUT_ACTION,
} from "../src/shared/input/actions.js";
import { normalizeInputAction } from "../src/shared/input/normalization.js";
import {
  PLAYBACK_CONTROL_DEFINITIONS,
  PlaybackControlActions,
  PlaybackControlIds,
} from "../src/shared/playback/controls.js";
import {
  PlaybackControlModes,
  PlaybackControlSurfaceDefinitions,
  PlaybackControlSurfaces,
} from "../src/shared/playback/surfaces.js";
import { POPUP_WIDTH_CONSTRAINTS } from "../src/shared/settings/contract.js";
import { InputActions } from "../src/shared/input/types.js";
import InputActionDispatcher from "../src/shell/input/actionDispatcher.js";
import { LoopStatus, PlaybackStatus } from "../src/shell/mpris/protocol.js";
import {
  PopupPlaybackControlRegions,
  PopupRegions,
} from "../src/shell/ui/popup/regions.js";
import { resolvePlaybackControlAccessibleName } from "../src/shell/media/playback/accessibility.js";
import { resolvePlaybackControlState } from "../src/shell/media/playback/controlState.js";
import {
  isPlaybackControlVisible,
  resolvePlaybackControlSurfaceUpdates,
} from "../src/shell/media/playback/surfaceState.js";
import {
  POPUP_WIDE_TRANSPORT_MIN_WIDTH,
  resolvePopupWidth,
} from "../src/shared/ui/popupLayout.js";
import {
  canChangePlaybackRate,
  formatPlaybackRate,
  resolveAvailablePlaybackRates,
  resolveNextPlaybackRate,
} from "../src/shell/mpris/playbackRate.js";
import {
  POPUP_PRIMARY_PLAYBACK_CONTROL_ORDER,
  POPUP_SECONDARY_PLAYBACK_CONTROL_ORDER,
  TOP_BAR_PLAYBACK_CONTROL_ORDER,
} from "../src/shell/ui/components/playback/order.js";
import { reconcileActorOrder } from "../src/shell/ui/components/actorOrder.js";
import { runCases } from "./helpers.mjs";

function player(overrides = {}) {
  return {
    playbackStatus: PlaybackStatus.PAUSED,
    loopStatus: LoopStatus.NONE,
    shuffle: false,
    rate: 1,
    minimumRate: 0.5,
    maximumRate: 2,
    canControl: true,
    canPlay: true,
    canPause: true,
    canGoPrevious: true,
    canGoNext: true,
    canSeek: true,
    canSetLoopStatus: true,
    canSetShuffle: true,
    canSetPlaybackRate: true,
    ...overrides,
  };
}

test("playback catalog, semantic order, state, and accessibility stay canonical", async () => {
  await runCases([
    [
      "identities",
      () => {
        const ids = PLAYBACK_CONTROL_DEFINITIONS.map(({ id }) => id);
        const actors = PLAYBACK_CONTROL_DEFINITIONS.map(
          ({ actorName }) => actorName,
        );
        assert.equal(new Set(ids).size, ids.length);
        assert.equal(new Set(actors).size, actors.length);
        assert.deepEqual(ids, Object.values(PlaybackControlIds));
      },
    ],
    [
      "orders",
      () => {
        assert.deepEqual(POPUP_PRIMARY_PLAYBACK_CONTROL_ORDER, [
          PlaybackControlIds.SEEK_BACKWARD,
          PlaybackControlIds.PREVIOUS,
          PlaybackControlIds.PLAY_PAUSE,
          PlaybackControlIds.NEXT,
          PlaybackControlIds.SEEK_FORWARD,
        ]);
        assert.deepEqual(POPUP_SECONDARY_PLAYBACK_CONTROL_ORDER, [
          PlaybackControlIds.SHUFFLE,
          PlaybackControlIds.SPEED,
          PlaybackControlIds.REPEAT,
        ]);
        assert.deepEqual(TOP_BAR_PLAYBACK_CONTROL_ORDER, [
          PlaybackControlIds.SHUFFLE,
          PlaybackControlIds.SEEK_BACKWARD,
          PlaybackControlIds.PREVIOUS,
          PlaybackControlIds.PLAY_PAUSE,
          PlaybackControlIds.NEXT,
          PlaybackControlIds.SEEK_FORWARD,
          PlaybackControlIds.REPEAT,
        ]);
      },
    ],
    [
      "play pause stop",
      () => {
        assert.equal(
          resolvePlaybackControlState(player(), PlaybackControlIds.PLAY_PAUSE)
            .action,
          PlaybackControlActions.PLAY,
        );
        assert.equal(
          resolvePlaybackControlState(
            player({ playbackStatus: PlaybackStatus.PLAYING }),
            PlaybackControlIds.PLAY_PAUSE,
          ).action,
          PlaybackControlActions.PAUSE,
        );
        assert.equal(
          resolvePlaybackControlState(
            player({
              playbackStatus: PlaybackStatus.PLAYING,
              canPause: false,
            }),
            PlaybackControlIds.PLAY_PAUSE,
          ).action,
          PlaybackControlActions.STOP,
        );
      },
    ],
    [
      "optional capabilities",
      () => {
        assert.equal(
          resolvePlaybackControlState(
            player({ canSetShuffle: false }),
            PlaybackControlIds.SHUFFLE,
          ).isReactive,
          false,
        );
        assert.equal(
          resolvePlaybackControlState(
            player({ canSetLoopStatus: false }),
            PlaybackControlIds.REPEAT,
          ).isReactive,
          false,
        );
        assert.equal(
          resolvePlaybackControlState(
            player({ canSetPlaybackRate: false }),
            PlaybackControlIds.SPEED,
          ).isReactive,
          false,
        );
      },
    ],
    [
      "accessible names",
      () => {
        const paused = player();
        const seek = resolvePlaybackControlState(
          paused,
          PlaybackControlIds.SEEK_BACKWARD,
        );
        assert.equal(
          resolvePlaybackControlAccessibleName(paused, seek),
          "Seek Backward: 10 s",
        );
        const repeatPlayer = player({ loopStatus: LoopStatus.TRACK });
        assert.equal(
          resolvePlaybackControlAccessibleName(
            repeatPlayer,
            resolvePlaybackControlState(
              repeatPlayer,
              PlaybackControlIds.REPEAT,
            ),
          ),
          "Repeat: Track",
        );
        assert.equal(
          resolvePlaybackControlAccessibleName(
            paused,
            resolvePlaybackControlState(paused, PlaybackControlIds.SPEED),
          ),
          "Playback Speed: 1×",
        );
      },
    ],
  ]);
});

test("application input actions use the MediaRuntime application capability", async () => {
  const calls = [];
  const activePlayer = { id: "active" };
  const mediaRuntime = {
    playback: {
      activePlayer,
      raise() {
        calls.push("playback-raise");
      },
    },
    application: {
      raise(player) {
        calls.push(["application-raise", player]);
        return Promise.resolve("raised");
      },
    },
    switchPlayer() {
      return false;
    },
  };
  const dispatcher = new InputActionDispatcher({ mediaRuntime });

  assert.equal(await dispatcher.execute(InputActions.RAISE_APP), "raised");
  assert.deepEqual(calls, [["application-raise", activePlayer]]);
  dispatcher.destroy();
});

test("surface policies and popup layout stay consistent", async () => {
  const transportControlIds = [
    PlaybackControlIds.SEEK_BACKWARD,
    PlaybackControlIds.PREVIOUS,
    PlaybackControlIds.PLAY_PAUSE,
    PlaybackControlIds.NEXT,
    PlaybackControlIds.SEEK_FORWARD,
  ];
  const visibility = (settingsTarget, activePlayer, controlIds) =>
    controlIds.map((controlId) =>
      isPlaybackControlVisible(
        settingsTarget,
        activePlayer,
        PlaybackControlSurfaces.POPUP,
        controlId,
      ),
    );
  const popupVisibility = (settingsTarget, activePlayer) => {
    const [
      showSeekBackward,
      showPreviousTrack,
      showPlayPause,
      showNextTrack,
      showSeekForward,
    ] = visibility(settingsTarget, activePlayer, transportControlIds);
    return {
      showSeekBackward,
      showPreviousTrack,
      showPlayPause,
      showNextTrack,
      showSeekForward,
    };
  };

  await runCases([
    [
      "surface ownership",
      () => {
        const popupDefinition =
          PlaybackControlSurfaceDefinitions[PlaybackControlSurfaces.POPUP];
        const topBarDefinition =
          PlaybackControlSurfaceDefinitions[PlaybackControlSurfaces.TOP_BAR];
        const popupIds = popupDefinition.controls.map(
          ({ controlId }) => controlId,
        );
        const topBarIds = topBarDefinition.controls.map(
          ({ controlId }) => controlId,
        );
        assert.deepEqual(popupIds, Object.values(PlaybackControlIds));
        assert.equal(topBarIds.includes(PlaybackControlIds.SPEED), false);
        assert.deepEqual(topBarIds, TOP_BAR_PLAYBACK_CONTROL_ORDER);
      },
    ],
    [
      "manual mode preserves configured controls",
      () => {
        const target = {
          playbackControlsShow: true,
          playbackControlsMode: PlaybackControlModes.MANUAL,
          playbackControlsSeekBackwardShow: true,
          playbackControlsSeekForwardShow: false,
          playbackControlsSpeedShow: true,
        };
        assert.deepEqual(
          resolvePlaybackControlSurfaceUpdates(
            target,
            player({ canSeek: false }),
            PlaybackControlSurfaces.POPUP,
            PopupPlaybackControlRegions,
            PopupRegions.PLAYBACK_SEEK_BACKWARD,
          ),
          [{ controlId: PlaybackControlIds.SEEK_BACKWARD, isVisible: true }],
        );
        target.playbackControlsShow = false;
        assert.deepEqual(
          resolvePlaybackControlSurfaceUpdates(
            target,
            player(),
            PlaybackControlSurfaces.POPUP,
            PopupPlaybackControlRegions,
            PopupRegions.PLAYBACK_CONTROLS,
          ).filter(({ isVisible }) => isVisible),
          [],
        );
      },
    ],
    [
      "adaptive mode prefers track navigation and falls back to seek",
      () => {
        const adaptive = {
          playbackControlsShow: true,
          playbackControlsMode: PlaybackControlModes.ADAPTIVE,
        };
        const navigationIds = [
          PlaybackControlIds.SEEK_BACKWARD,
          PlaybackControlIds.PREVIOUS,
          PlaybackControlIds.NEXT,
          PlaybackControlIds.SEEK_FORWARD,
        ];
        assert.deepEqual(visibility(adaptive, player(), navigationIds), [
          false,
          true,
          true,
          false,
        ]);
        assert.deepEqual(
          visibility(
            adaptive,
            player({ canGoPrevious: false, canGoNext: false }),
            navigationIds,
          ),
          [true, false, false, true],
        );
      },
    ],
    [
      "full mode exposes every executable control",
      () => {
        const full = {
          playbackControlsShow: true,
          playbackControlsMode: PlaybackControlModes.FULL,
        };
        assert.deepEqual(visibility(full, player(), transportControlIds), [
          true,
          true,
          true,
          true,
          true,
        ]);
        assert.deepEqual(
          visibility(full, player({ canSeek: false }), transportControlIds),
          [false, true, true, true, false],
        );
      },
    ],
    [
      "width policy consumes effective transport visibility",
      () => {
        const controls = {
          showPreviousTrack: true,
          showPlayPause: true,
          showNextTrack: true,
        };
        const adaptive = {
          playbackControlsShow: true,
          playbackControlsMode: PlaybackControlModes.ADAPTIVE,
        };
        const full = {
          playbackControlsShow: true,
          playbackControlsMode: PlaybackControlModes.FULL,
        };

        assert.equal(POPUP_WIDTH_CONSTRAINTS.DEFAULT, 250);
        assert.equal(POPUP_WIDE_TRANSPORT_MIN_WIDTH, 350);
        assert.equal(resolvePopupWidth(250, controls), 250);
        assert.equal(
          resolvePopupWidth(250, { ...controls, showSeekForward: true }),
          350,
        );
        assert.equal(
          resolvePopupWidth(250, {
            showSeekBackward: true,
            showPlayPause: true,
            showSeekForward: true,
          }),
          250,
        );
        assert.equal(
          resolvePopupWidth(250, {
            showSeekBackward: true,
            showPreviousTrack: true,
            showNextTrack: true,
            showSeekForward: true,
          }),
          250,
        );
        assert.equal(
          resolvePopupWidth(250, popupVisibility(adaptive, player())),
          250,
        );
        assert.equal(
          resolvePopupWidth(250, popupVisibility(full, player())),
          350,
        );
        assert.equal(
          resolvePopupWidth(
            250,
            popupVisibility(
              adaptive,
              player({ canGoPrevious: false, canGoNext: false }),
            ),
          ),
          250,
        );
        assert.equal(
          resolvePopupWidth(420, popupVisibility(full, player())),
          420,
        );
      },
    ],
  ]);
});

test("input actions expose only executable 3.x actions", async () => {
  await runCases([
    [
      "persisted values",
      () => {
        assert.deepEqual(InputActions, {
          NONE: 0,
          TOGGLE_SHUFFLE: 1,
          PREVIOUS_TRACK: 2,
          PLAY_PAUSE: 3,
          NEXT_TRACK: 4,
          TOGGLE_LOOP: 5,
          VOLUME_UP: 6,
          VOLUME_DOWN: 7,
          TOGGLE_POPUP: 8,
          OPEN_PREFERENCES: 9,
          RAISE_APP: 10,
          QUIT_APP: 11,
          SWITCH_APP: 12,
          SEEK_BACKWARD: 13,
          SEEK_FORWARD: 14,
        });
        for (const unsupported of [15, 16, 17])
          assert.equal(normalizeInputAction(unsupported), InputActions.NONE);
      },
    ],
    [
      "visual order",
      () => {
        assert.deepEqual(MOUSE_ACTION_VALUES.slice(0, 8), [
          InputActions.NONE,
          InputActions.TOGGLE_SHUFFLE,
          InputActions.SEEK_BACKWARD,
          InputActions.PREVIOUS_TRACK,
          InputActions.PLAY_PAUSE,
          InputActions.NEXT_TRACK,
          InputActions.SEEK_FORWARD,
          InputActions.TOGGLE_LOOP,
        ]);
      },
    ],
    [
      "shared playback mapping",
      () => {
        const playbackDefinitions = INPUT_ACTION_DEFINITIONS.filter(
          ({ playbackAction }) => playbackAction,
        );
        assert.ok(playbackDefinitions.length > 0);
        for (const definition of playbackDefinitions)
          assert.equal(
            PLAYBACK_ACTION_BY_INPUT_ACTION[definition.action],
            definition.playbackAction,
          );
        assert.equal(
          Object.values(PLAYBACK_ACTION_BY_INPUT_ACTION).includes(
            "rate-increase",
          ),
          false,
        );
      },
    ],
  ]);
});

test("playback rates and actor reconciliation remain reusable", async () => {
  await runCases([
    [
      "rate ranges",
      () => {
        assert.deepEqual(
          resolveAvailablePlaybackRates(0.8, 1.2),
          [0.8, 1, 1.2],
        );
        assert.deepEqual(
          resolveAvailablePlaybackRates(1, 3),
          [1, 1.25, 1.5, 2, 3],
        );
        assert.equal(canChangePlaybackRate(1, 1), false);
        assert.equal(canChangePlaybackRate(0.8, 1.2), true);
        assert.equal(resolveNextPlaybackRate(1, 0.8, 1.2), 1.2);
        assert.equal(resolveNextPlaybackRate(1.2, 0.8, 1.2), 0.8);
        assert.equal(formatPlaybackRate(1.25, "en-US"), "1.25×");
      },
    ],
    [
      "actor order",
      () => {
        const children = [];
        const parent = {
          get_children: () => [...children],
          insert_child_at_index(actor, index) {
            const current = children.indexOf(actor);
            if (current >= 0) children.splice(current, 1);
            children.splice(index, 0, actor);
            actor.parent = parent;
          },
          remove_child(actor) {
            const index = children.indexOf(actor);
            if (index >= 0) children.splice(index, 1);
            actor.parent = null;
          },
        };
        const actor = (name) => ({
          name,
          parent: null,
          get_parent() {
            return this.parent;
          },
        });
        const shuffle = actor("shuffle");
        const speed = actor("speed");
        const repeat = actor("repeat");
        reconcileActorOrder(parent, [shuffle, speed, repeat]);
        assert.deepEqual(
          children.map(({ name }) => name),
          ["shuffle", "speed", "repeat"],
        );
        reconcileActorOrder(parent, [repeat, null, shuffle]);
        assert.deepEqual(
          children.map(({ name }) => name),
          ["repeat", "shuffle", "speed"],
        );
      },
    ],
  ]);
});
