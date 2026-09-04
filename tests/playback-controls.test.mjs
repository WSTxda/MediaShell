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
  PlaybackControlSurfaceDefinitions,
  PlaybackControlSurfaces,
} from "../src/shared/playback/surfaces.js";
import { POPUP_SEEK_CONTROLS_MIN_WIDTH } from "../src/shared/ui/popup.js";
import {
  POPUP_WIDTH_CONSTRAINTS,
  SettingsKeys,
} from "../src/shared/settings/contract.js";
import { InputActions } from "../src/shared/input/types.js";
import { LoopStatus, PlaybackStatus } from "../src/shell/mpris/protocol.js";
import {
  PopupPlaybackControlRegions,
  PopupRegions,
} from "../src/shell/ui/popup/regions.js";
import { resolvePlaybackControlAccessibleName } from "../src/shell/media/playback/accessibility.js";
import { resolvePlaybackControlState } from "../src/shell/media/playback/controlState.js";
import { resolvePlaybackControlSurfaceUpdates } from "../src/shell/media/playback/surfaceState.js";
import { resolvePopupWidth } from "../src/shared/ui/popupLayout.js";
import {
  canChangePlaybackRate,
  formatPlaybackRate,
  getAvailablePlaybackRates,
  resolveNextPlaybackRate,
} from "../src/shell/mpris/playbackRate.js";
import {
  POPUP_PRIMARY_PLAYBACK_CONTROL_ORDER,
  POPUP_SECONDARY_PLAYBACK_CONTROL_ORDER,
  TOP_BAR_PLAYBACK_CONTROL_ORDER,
} from "../src/shell/ui/components/playback/order.js";
import PopupLayoutController from "../src/prefs/controllers/popupLayoutController.js";
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
          "Seek backward: 10 s",
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
          "Playback speed: 1×",
        );
      },
    ],
  ]);
});

test("surface policies and popup layout stay consistent", async () => {
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
      "targeted updates",
      () => {
        const target = {
          playbackControlsShow: true,
          playbackControlsSeekBackwardShow: true,
          playbackControlsSeekForwardShow: false,
          playbackControlsSpeedShow: true,
        };
        assert.deepEqual(
          resolvePlaybackControlSurfaceUpdates(
            target,
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
            PlaybackControlSurfaces.POPUP,
            PopupPlaybackControlRegions,
            PopupRegions.PLAYBACK_CONTROLS,
          ).filter(({ isVisible }) => isVisible),
          [],
        );
      },
    ],
    [
      "width policy",
      () => {
        assert.equal(POPUP_WIDTH_CONSTRAINTS.DEFAULT, 250);
        assert.equal(POPUP_SEEK_CONTROLS_MIN_WIDTH, 350);
        assert.equal(resolvePopupWidth(250, false, false), 250);
        assert.equal(resolvePopupWidth(250, true, false), 350);
        assert.equal(resolvePopupWidth(320, false, true), 350);
        assert.equal(resolvePopupWidth(420, true, true), 420);
      },
    ],
    [
      "width preference feedback",
      async () => {
        const createWidget = (state) => {
          const callbacks = new Map();
          return {
            state,
            connect(signal, callback) {
              callbacks.set(signal, callback);
              return callbacks.size;
            },
            disconnect() {},
            emit(signal) {
              callbacks.get(signal)?.();
            },
            get_enable_expansion() {
              return this.state.enabled;
            },
            get_active() {
              return this.state.active;
            },
          };
        };
        const controls = createWidget({ enabled: false });
        const seekBackward = createWidget({ active: false });
        const seekForward = createWidget({ active: false });
        const objects = new Map([
          ["er-popup-playback-controls", controls],
          ["sr-popup-playback-controls-seek-backward-show", seekBackward],
          ["sr-popup-playback-controls-seek-forward-show", seekForward],
        ]);
        let width = 250;
        let writes = 0;
        const settings = {
          get_uint: () => width,
          set_uint(key, value) {
            assert.equal(key, SettingsKeys.POPUP_WIDTH);
            width = value;
            writes += 1;
          },
        };
        const controller = new PopupLayoutController(settings, {
          get_object: (id) => objects.get(id) ?? null,
        });

        controller.init();
        assert.equal(writes, 0, "initialization must not rewrite settings");

        seekBackward.state.active = true;
        seekBackward.emit("notify::active");
        await Promise.resolve();
        assert.equal(writes, 0, "disabled controls must not change width");

        controls.state.enabled = true;
        seekBackward.state.active = false;
        controls.emit("notify::enable-expansion");
        seekBackward.emit("notify::active");
        await Promise.resolve();
        assert.equal(
          writes,
          0,
          "batched changes must use the final preference state",
        );

        seekBackward.state.active = true;
        seekBackward.emit("notify::active");
        await Promise.resolve();
        assert.equal(width, 350);
        assert.equal(writes, 1);

        seekForward.state.active = true;
        seekForward.emit("notify::active");
        await Promise.resolve();
        assert.equal(writes, 1, "the minimum must not be written twice");

        width = 250;
        seekForward.emit("notify::active");
        controller.destroy();
        await Promise.resolve();
        assert.equal(width, 250, "destroy must invalidate pending feedback");
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
        assert.deepEqual(getAvailablePlaybackRates(0.8, 1.2), [0.8, 1, 1.2]);
        assert.deepEqual(getAvailablePlaybackRates(1, 3), [1, 1.25, 1.5, 2, 3]);
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
