/**
 * @file mediaActionFeedback.js
 * @module shell.ui.feedback.mediaActionFeedback
 *
 * Presents native OSD feedback for MediaShell input actions.
 *
 * Only actions routed through InputActionDispatcher reach this owner, so global
 * shortcuts and Top Bar pointer gestures receive feedback while Popup, Top Bar
 * playback buttons, and private native controls keep their direct
 * PlaybackController path. Track actions correlate against semantic transitions;
 * PlayPause waits for canonical PlaybackStatus instead of predicting the result.
 */

import GLib from "gi://GLib";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { VOLUME_STEP } from "../../../shared/input/actions.js";
import { InputActions } from "../../../shared/input/types.js";
import {
  PlaybackControlDefinitions,
  RELATIVE_SEEK_SECONDS,
} from "../../../shared/playback/controls.js";
import {
  resolveNextLoopStatus,
  resolveVolumeTarget,
} from "../../media/playback/playbackController.js";
import { MprisOperationStatuses } from "../../mpris/operationResult.js";
import {
  LoopStatus,
  MprisPlayerProperties,
  PlaybackStatus,
} from "../../mpris/protocol.js";

const FEEDBACK_CONFIRMATION_TIMEOUT_MS = 2500;

function resolveVolumePresentationLevel(volume) {
  return Math.min(1, Math.max(0, Number(volume) || 0));
}

function resolveVolumeIconName(level) {
  if (level <= 0) return "audio-volume-muted-symbolic";
  if (level < 0.33) return "audio-volume-low-symbolic";
  if (level < 0.66) return "audio-volume-medium-symbolic";
  return "audio-volume-high-symbolic";
}

function resolvePlaybackStatusPresentation(player) {
  const playbackStatus = player.playbackStatus;
  if (
    playbackStatus !== PlaybackStatus.PLAYING &&
    playbackStatus !== PlaybackStatus.PAUSED
  )
    return null;

  return {
    iconName:
      playbackStatus === PlaybackStatus.PLAYING
        ? PlaybackControlDefinitions.PLAY_PAUSE.icons.PLAY
        : PlaybackControlDefinitions.PLAY_PAUSE.icons.PAUSE,
    label:
      playbackStatus === PlaybackStatus.PLAYING ? _("Playing") : _("Paused"),
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

function resolveTrackAction(inputAction) {
  if (inputAction === InputActions.PREVIOUS_TRACK)
    return { iconName: PlaybackControlDefinitions.PREVIOUS.icons.DEFAULT };
  if (inputAction === InputActions.NEXT_TRACK)
    return { iconName: PlaybackControlDefinitions.NEXT.icons.DEFAULT };
  return null;
}

/** Owns transient visual feedback for keyboard and Top Bar pointer actions. */
export default class MediaActionFeedback {
  constructor({ transitionTracker, showOsd } = {}) {
    if (!transitionTracker)
      throw new TypeError(
        "MediaActionFeedback requires TrackTransitionTracker",
      );
    if (typeof showOsd !== "function")
      throw new TypeError("MediaActionFeedback requires showOsd");

    this.transitionTracker = transitionTracker;
    this.showOsd = showOsd;
    this.player = null;
    this.generation = 0;
    this.pendingTrackActions = [];
    this.pendingPlaybackStatusActions = [];
    this.unsubscribeTransition = transitionTracker.onTransition((transition) =>
      this.handleTransition(transition),
    );
  }

  setPlayer(player) {
    const nextPlayer = player ?? null;
    if (nextPlayer === this.player) return;
    this.reset();
    this.player = nextPlayer;
    this.generation++;
  }

  begin(inputAction, player) {
    if (!player || player !== this.player) return null;

    const trackAction = resolveTrackAction(inputAction);
    if (trackAction) return this.createTrackActionContext(player, trackAction);

    if (inputAction === InputActions.PLAY_PAUSE)
      return this.createPlaybackStatusContext(player);

    const presentation = resolveImmediatePresentation(inputAction, player);
    return presentation
      ? {
          kind: "immediate",
          player,
          generation: this.generation,
          presentation,
        }
      : null;
  }

  createTrackActionContext(player, { iconName }) {
    const context = {
      kind: "track",
      player,
      iconName,
      generation: this.generation,
      operationSucceeded: false,
      transition: null,
      timeoutId: null,
      active: true,
    };
    context.timeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      FEEDBACK_CONFIRMATION_TIMEOUT_MS,
      () => {
        context.timeoutId = null;
        this.removeTrackAction(context);
        return GLib.SOURCE_REMOVE;
      },
    );
    this.pendingTrackActions.push(context);
    return context;
  }

  createPlaybackStatusContext(player) {
    const context = {
      kind: "playback-status",
      player,
      initialPlaybackStatus: player.playbackStatus,
      generation: this.generation,
      statusChanged: false,
      operationSucceeded: false,
      listenerId: 0,
      timeoutId: null,
      active: true,
    };
    context.listenerId = player.onPropertyChanged(
      MprisPlayerProperties.PLAYBACK_STATUS,
      () => {
        if (!context.active) return;
        context.statusChanged = true;
        if (context.operationSucceeded) this.showPlaybackStatus(context);
      },
    );
    context.timeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      FEEDBACK_CONFIRMATION_TIMEOUT_MS,
      () => {
        context.timeoutId = null;
        this.removePlaybackStatusAction(context);
        return GLib.SOURCE_REMOVE;
      },
    );
    this.pendingPlaybackStatusActions.push(context);
    return context;
  }

  complete(context, operationResult) {
    if (!context) return;
    if (
      context.player !== this.player ||
      context.generation !== this.generation
    ) {
      this.removeContext(context);
      return;
    }

    if (operationResult?.status !== MprisOperationStatuses.SUCCESS) {
      this.removeContext(context);
      return;
    }

    if (context.kind === "immediate") {
      this.show(context.presentation);
      return;
    }

    if (!context.active) return;
    context.operationSucceeded = true;

    if (context.kind === "track") {
      if (context.transition) this.showTrackAction(context);
      return;
    }

    if (context.kind === "playback-status") {
      if (context.player.playbackStatus !== context.initialPlaybackStatus)
        context.statusChanged = true;
      if (context.statusChanged) this.showPlaybackStatus(context);
    }
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

  showPlaybackStatus(context) {
    if (!context.active) return;
    const presentation = resolvePlaybackStatusPresentation(context.player);
    if (presentation) this.show(presentation);
    this.removePlaybackStatusAction(context);
  }

  show(presentation) {
    if (!presentation?.iconName) return;
    this.showOsd(presentation);
  }

  removeContext(context) {
    if (context?.kind === "track") this.removeTrackAction(context);
    else if (context?.kind === "playback-status")
      this.removePlaybackStatusAction(context);
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

  removePlaybackStatusAction(context) {
    if (!context || !context.active) return;
    context.active = false;
    if (context.timeoutId !== null) {
      GLib.Source.remove(context.timeoutId);
      context.timeoutId = null;
    }
    if (context.listenerId)
      context.player.removePropertyChangeListener(
        MprisPlayerProperties.PLAYBACK_STATUS,
        context.listenerId,
      );
    context.listenerId = 0;
    const index = this.pendingPlaybackStatusActions.indexOf(context);
    if (index >= 0) this.pendingPlaybackStatusActions.splice(index, 1);
  }

  reset() {
    for (const context of [...this.pendingTrackActions])
      this.removeTrackAction(context);
    for (const context of [...this.pendingPlaybackStatusActions])
      this.removePlaybackStatusAction(context);
    this.pendingTrackActions = [];
    this.pendingPlaybackStatusActions = [];
  }

  destroy() {
    this.unsubscribeTransition();
    this.unsubscribeTransition = null;
    this.reset();
    this.player = null;
    this.generation++;
    this.transitionTracker = null;
    this.showOsd = null;
  }
}
