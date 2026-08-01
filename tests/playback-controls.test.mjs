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
  LEGACY_INPUT_ACTION_SCHEMA_NICKS,
  MOUSE_ACTION_VALUES,
  PLAYBACK_ACTION_BY_INPUT_ACTION,
} from "../src/shared/constants/inputActions.js";
import { normalizeInputAction } from "../src/shared/utils/inputActions.js";
import {
  PLAYBACK_CONTROL_DEFINITIONS,
  PlaybackControlActions,
  PlaybackControlIds,
  RELATIVE_SEEK_SECONDS,
} from "../src/shared/constants/playbackControls.js";
import {
  PlaybackControlSurfaceDefinitions,
  PlaybackControlSurfaces,
} from "../src/shared/constants/playbackControlSurfaces.js";
import { POPUP_SEEK_CONTROLS_MIN_WIDTH } from "../src/shared/constants/popup.js";
import {
  POPUP_WIDTH_CONSTRAINTS,
  SettingsKeys,
} from "../src/shared/constants/settings.js";
import { InputActions } from "../src/shared/enums/input.js";
import { LoopStatus, PlaybackStatus } from "../src/shared/enums/playback.js";
import { WidgetFlags } from "../src/shared/enums/widgetFlags.js";
import { resolvePlaybackControlAccessibleName } from "../src/shared/utils/playbackControlAccessibility.js";
import { resolvePlaybackControlState } from "../src/shared/utils/playbackControlState.js";
import { resolvePlaybackControlSurfaceUpdates } from "../src/shared/utils/playbackControlSurfaceState.js";
import { resolvePopupWidth } from "../src/shared/utils/popupLayout.js";
import {
  canChangePlaybackRate,
  formatPlaybackRate,
  getAvailablePlaybackRates,
  resolveNextPlaybackRate,
} from "../src/shared/utils/playbackRate.js";
import {
  POPUP_PRIMARY_PLAYBACK_CONTROL_ORDER,
  POPUP_SECONDARY_PLAYBACK_CONTROL_ORDER,
  TOP_BAR_PLAYBACK_CONTROL_ORDER,
} from "../src/shell/constants/playbackControls.js";
import { SETTINGS_SPEC } from "../src/shell/settings/settingsSpec.js";
import { reconcileActorOrder } from "../src/shell/utils/actors.js";
import { runCases } from "./helpers.mjs";

function mediaApp(overrides = {}) {
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
          resolvePlaybackControlState(mediaApp(), PlaybackControlIds.PLAY_PAUSE)
            .action,
          PlaybackControlActions.PLAY,
        );
        assert.equal(
          resolvePlaybackControlState(
            mediaApp({ playbackStatus: PlaybackStatus.PLAYING }),
            PlaybackControlIds.PLAY_PAUSE,
          ).action,
          PlaybackControlActions.PAUSE,
        );
        assert.equal(
          resolvePlaybackControlState(
            mediaApp({
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
            mediaApp({ canSetShuffle: false }),
            PlaybackControlIds.SHUFFLE,
          ).isReactive,
          false,
        );
        assert.equal(
          resolvePlaybackControlState(
            mediaApp({ canSetLoopStatus: false }),
            PlaybackControlIds.REPEAT,
          ).isReactive,
          false,
        );
        assert.equal(
          resolvePlaybackControlState(
            mediaApp({ canSetPlaybackRate: false }),
            PlaybackControlIds.SPEED,
          ).isReactive,
          false,
        );
      },
    ],
    [
      "accessible names",
      () => {
        const paused = mediaApp();
        const seek = resolvePlaybackControlState(
          paused,
          PlaybackControlIds.SEEK_BACKWARD,
        );
        assert.equal(
          resolvePlaybackControlAccessibleName(paused, seek),
          "Seek backward: 10 s",
        );
        const repeatApp = mediaApp({ loopStatus: LoopStatus.TRACK });
        assert.equal(
          resolvePlaybackControlAccessibleName(
            repeatApp,
            resolvePlaybackControlState(repeatApp, PlaybackControlIds.REPEAT),
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

test("surface policies and popup layout preserve defaults without compacting controls", async () => {
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
        assert.equal(
          popupDefinition.controls.find(
            ({ controlId }) => controlId === PlaybackControlIds.SPEED,
          ).requiresSurfaceEnabled,
          false,
        );
        assert.ok(
          popupDefinition.controls
            .filter(({ controlId }) => controlId !== PlaybackControlIds.SPEED)
            .every(({ requiresSurfaceEnabled }) => requiresSurfaceEnabled),
        );
      },
    ],
    [
      "first-install defaults",
      () => {
        const popup =
          PlaybackControlSurfaceDefinitions[PlaybackControlSurfaces.POPUP]
            .controls;
        const topBar =
          PlaybackControlSurfaceDefinitions[PlaybackControlSurfaces.TOP_BAR]
            .controls;
        assert.deepEqual(
          Object.fromEntries(
            popup.map(({ controlId }) => [
              controlId,
              ["previous", "play-pause", "next", "shuffle", "repeat"].includes(
                controlId,
              ),
            ]),
          ),
          {
            shuffle: true,
            "seek-backward": false,
            previous: true,
            "play-pause": true,
            next: true,
            "seek-forward": false,
            repeat: true,
            speed: false,
          },
        );
        assert.ok(
          topBar.every(
            ({ controlId }) =>
              ["previous", "play-pause", "next"].includes(controlId) ||
              ["shuffle", "seek-backward", "seek-forward", "repeat"].includes(
                controlId,
              ),
          ),
        );
      },
    ],
    [
      "targeted updates",
      () => {
        const target = {
          popupPlaybackControlsShow: true,
          popupPlaybackControlsSeekBackwardShow: true,
          popupPlaybackControlsSeekForwardShow: false,
          popupPlaybackControlsSpeedShow: true,
        };
        assert.deepEqual(
          resolvePlaybackControlSurfaceUpdates(
            target,
            PlaybackControlSurfaces.POPUP,
            WidgetFlags.POPUP_PLAYBACK_SEEK_BACKWARD,
          ),
          [{ controlId: PlaybackControlIds.SEEK_BACKWARD, isVisible: true }],
        );
        target.popupPlaybackControlsShow = false;
        assert.deepEqual(
          resolvePlaybackControlSurfaceUpdates(
            target,
            PlaybackControlSurfaces.POPUP,
            WidgetFlags.POPUP_PLAYBACK_CONTROLS,
          ).filter(({ isVisible }) => isVisible),
          [{ controlId: PlaybackControlIds.SPEED, isVisible: true }],
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
  ]);
});

test("input actions stay append-only while executable lists exclude retired speed actions", async () => {
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
          RESERVED_15: 15,
          RESERVED_16: 16,
          RESERVED_17: 17,
        });
        for (const legacy of [15, 16, 17])
          assert.equal(normalizeInputAction(legacy), InputActions.NONE);
        assert.deepEqual(LEGACY_INPUT_ACTION_SCHEMA_NICKS, {
          15: "RATE_DECREASE",
          16: "RATE_INCREASE",
          17: "RATE_RESET",
        });

        for (const key of [
          SettingsKeys.INTERACTIONS_MOUSE_ACTION_LEFT,
          SettingsKeys.INTERACTIONS_MOUSE_ACTION_MIDDLE,
          SettingsKeys.INTERACTIONS_MOUSE_ACTION_RIGHT,
          SettingsKeys.INTERACTIONS_MOUSE_ACTION_DOUBLE,
          SettingsKeys.INTERACTIONS_MOUSE_ACTION_SCROLL_UP,
          SettingsKeys.INTERACTIONS_MOUSE_ACTION_SCROLL_DOWN,
        ]) {
          assert.equal(
            SETTINGS_SPEC[key].transform(InputActions.RESERVED_15),
            InputActions.NONE,
          );
        }
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

test("fixed seek, flexible rate ranges, and actor reconciliation remain reusable", async () => {
  await runCases([
    [
      "seek",
      () => {
        assert.equal(RELATIVE_SEEK_SECONDS, 10);
      },
    ],
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
