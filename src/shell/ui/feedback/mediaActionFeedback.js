/**
 * @file mediaActionFeedback.js
 * @module shell.ui.feedback.mediaActionFeedback
 *
 * Presents native OSD feedback for MediaShell input actions.
 *
 * Only actions routed through InputActionDispatcher reach this owner, so global
 * shortcuts and Top Bar pointer gestures receive feedback while Popup, Top Bar
 * playback buttons, and private native controls keep their existing direct
 * PlaybackController path. The owner contains transient Next/Previous
 * correlation state and delegates all drawing, timing, and Shell compatibility
 * to the shared OSD integration.
 */

import GLib from "gi://GLib";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { InputActions } from "../../../shared/input/types.js";
import { VOLUME_STEP } from "../../../shared/input/actions.js";
import {
  PlaybackControlDefinitions,
  RELATIVE_SEEK_SECONDS,
} from "../../../shared/playback/controls.js";
import { MprisOperationStatuses } from "../../mpris/operationResult.js";
import { LoopStatus, PlaybackStatus } from "../../mpris/protocol.js";
import {
  resolveNextLoopStatus,
  resolveVolumeTarget,
} from "../../media/playback/playbackController.js";

const TRACK_ACTION_TIMEOUT_MS = 2000;

function resolveVolumePresentationLevel(volume) {
  return Math.min(1, Math.max(0, Number(volume) || 0));
}

function resolveVolumeIconName(level) {
  if (level <= 0) return "audio-volume-muted-symbolic";
  if (level < 0.33) return "audio-volume-low-symbolic";
  if (level < 0.66) return "audio-volume-medium-symbolic";
  return "audio-volume-high-symbolic";
}

function resolvePlayPausePresentation(player) {
  const control = PlaybackControlDefinitions.PLAY_PAUSE;
  const willPlay = player.playbackStatus !== PlaybackStatus.PLAYING;

  if (!willPlay)
    return {
      iconName: control.icons.PLAY,
      label: _("Paused"),
    };

  return {
    iconName:
      player.canControl && !player.canPause
        ? control.icons.STOP
        : control.icons.PAUSE,
    label: _("Playing"),
  };
}

function resolveImmediatePresentation(inputAction, player) {
  switch (inputAction) {
    case InputActions.TOGGLE_SHUFFLE: {
      const enabled = !player.shuffle;
      return {
        iconName: enabled
          ? PlaybackControlDefinitions.SHUFFLE.icons.ON
          : PlaybackControlDefinitions.SHUFFLE.icons.OFF,
        label: enabled ? _("Enabled") : _("Disabled"),
      };
    }
    case InputActions.SEEK_BACKWARD:
      return {
        iconName: PlaybackControlDefinitions.SEEK_BACKWARD.icons.DEFAULT,
        label: `−${RELATIVE_SEEK_SECONDS}`,
      };
    case InputActions.PLAY_PAUSE:
      return resolvePlayPausePresentation(player);
    case InputActions.SEEK_FORWARD:
      return {
        iconName: PlaybackControlDefinitions.SEEK_FORWARD.icons.DEFAULT,
        label: `+${RELATIVE_SEEK_SECONDS}`,
      };
    case InputActions.TOGGLE_LOOP: {
      const loopStatus = resolveNextLoopStatus(player.loopStatus);
      const control = PlaybackControlDefinitions.REPEAT;
      if (loopStatus === LoopStatus.TRACK)
        return { iconName: control.icons.TRACK, label: _("Track") };
      if (loopStatus === LoopStatus.PLAYLIST)
        return { iconName: control.icons.PLAYLIST, label: _("Playlist") };
      return { iconName: control.icons.NONE, label: _("Off") };
    }
    case InputActions.VOLUME_UP:
    case InputActions.VOLUME_DOWN: {
      const delta =
        inputAction === InputActions.VOLUME_UP ? VOLUME_STEP : -VOLUME_STEP;
      const targetVolume = resolveVolumeTarget(player.volume, delta);
      if (targetVolume === null) return null;
      const level = resolveVolumePresentationLevel(targetVolume);
      return {
        iconName: resolveVolumeIconName(level),
        label: null,
        level,
        maxLevel: 1,
      };
    }
    default:
      return null;
  }
}

function resolveTrackActionIconName(inputAction) {
  if (inputAction === InputActions.PREVIOUS_TRACK)
    return PlaybackControlDefinitions.PREVIOUS.icons.DEFAULT;
  if (inputAction === InputActions.NEXT_TRACK)
    return PlaybackControlDefinitions.NEXT.icons.DEFAULT;
  return null;
}

/** Owns transient visual feedback for keyboard and Top Bar pointer actions. */
export default class MediaActionFeedback {
  constructor({ transitionTracker, osdIntegration } = {}) {
    if (!transitionTracker)
      throw new TypeError("MediaActionFeedback requires TrackTransitionTracker");
    if (!osdIntegration)
      throw new TypeError("MediaActionFeedback requires OsdIntegration");

    this.transitionTracker = transitionTracker;
    this.osdIntegration = osdIntegration;
    this.pendingTrackActions = [];
    this.unsubscribeTransition = transitionTracker.onTransition((transition) =>
      this.handleTransition(transition),
    );
  }

  begin(inputAction, player) {
    if (!player) return null;

    const trackIconName = resolveTrackActionIconName(inputAction);
    if (trackIconName) {
      const context = {
        kind: "track",
        player,
        iconName: trackIconName,
        operationSucceeded: false,
        transition: null,
        timeoutId: null,
        active: true,
      };
      context.timeoutId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        TRACK_ACTION_TIMEOUT_MS,
        () => {
          context.timeoutId = null;
          this.removeTrackAction(context);
          return GLib.SOURCE_REMOVE;
        },
      );
      this.pendingTrackActions.push(context);
      return context;
    }

    const presentation = resolveImmediatePresentation(inputAction, player);
    return presentation ? { kind: "immediate", presentation } : null;
  }

  complete(context, operationResult) {
    if (!context) return;

    if (operationResult?.status !== MprisOperationStatuses.SUCCESS) {
      if (context.kind === "track") {
        const transition = context.transition;
        this.removeTrackAction(context);
        if (transition) this.handleTransition(transition);
      }
      return;
    }

    if (context.kind === "immediate") {
      this.show(context.presentation);
      return;
    }

    if (context.kind !== "track" || !context.active) return;
    context.operationSucceeded = true;
    if (context.transition) this.showTrackAction(context);
  }

  handleTransition(transition) {
    const context = this.pendingTrackActions.find(
      (candidate) =>
        candidate.active &&
        !candidate.transition &&
        candidate.player === transition?.player,
    );
    if (!context) return;

    context.transition = transition;
    if (context.operationSucceeded) this.showTrackAction(context);
  }

  showTrackAction(context) {
    if (!context.active || !context.transition) return;

    const title =
      typeof context.transition.track?.title === "string"
        ? context.transition.track.title.trim()
        : "";
    if (title)
      this.show({
        iconName: context.iconName,
        label: title,
      });

    this.removeTrackAction(context);
  }

  show(presentation) {
    if (!presentation?.iconName) return;
    this.osdIntegration.show(presentation);
  }

  removeTrackAction(context) {
    if (!context || !context.active) return;
    context.active = false;
    if (context.timeoutId !== null) {
      GLib.Source.remove(context.timeoutId);
      context.timeoutId = null;
    }
    const index = this.pendingTrackActions.indexOf(context);
    if (index >= 0) this.pendingTrackActions.splice(index, 1);
  }

  destroy() {
    if (this.unsubscribeTransition) this.unsubscribeTransition();
    this.unsubscribeTransition = null;
    for (const context of [...this.pendingTrackActions])
      this.removeTrackAction(context);
    this.pendingTrackActions = [];
    this.transitionTracker = null;
    this.osdIntegration = null;
  }
}
