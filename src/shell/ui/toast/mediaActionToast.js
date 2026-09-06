/**
 * @file mediaActionToast.js
 * @module shell.ui.toast.mediaActionToast
 *
 * Presents MediaShell InputAction feedback through the native Shell OSD.
 *
 * Only InputActionDispatcher events reach this owner, so global shortcuts and
 * Top Bar pointer gestures receive feedback while Popup playback buttons and
 * private native controls keep their direct PlaybackController path. Track
 * actions correlate against semantic transitions; PlayPause waits for canonical
 * PlaybackStatus instead of predicting the result.
 */

import GLib from "gi://GLib";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { VOLUME_STEP } from "../../../shared/input/actions.js";
import { InputActions } from "../../../shared/input/types.js";
import {
  PlaybackControlDefinitions,
  RELATIVE_SEEK_SECONDS,
} from "../../../shared/playback/controls.js";
import { InputActionPhases } from "../../input/actionDispatcher.js";
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

function resolveTrackAction(inputAction, playbackAction) {
  if (inputAction === InputActions.PREVIOUS_TRACK)
    return {
      playbackAction,
      iconName: PlaybackControlDefinitions.PREVIOUS.icons.DEFAULT,
    };
  if (inputAction === InputActions.NEXT_TRACK)
    return {
      playbackAction,
      iconName: PlaybackControlDefinitions.NEXT.icons.DEFAULT,
    };
  return null;
}

/** Owns native OSD feedback for keyboard and Top Bar pointer InputActions. */
export default class MediaActionToast {
  constructor({ transitionTracker, inputActions, showOsd } = {}) {
    if (!transitionTracker)
      throw new TypeError("MediaActionToast requires TrackTransitionTracker");
    if (!inputActions)
      throw new TypeError("MediaActionToast requires InputActionDispatcher");
    if (typeof showOsd !== "function")
      throw new TypeError("MediaActionToast requires showOsd");

    this.transitionTracker = transitionTracker;
    this.inputActions = inputActions;
    this.showOsd = showOsd;
    this.player = null;
    this.generation = 0;
    this.pendingImmediateActions = [];
    this.pendingTrackActions = [];
    this.pendingPlaybackStatusActions = [];
    this.unsubscribeTransition = transitionTracker.onTransition((transition) =>
      this.handleTransition(transition),
    );
    this.unsubscribeInputAction = inputActions.onAction((event) =>
      this.handleInputAction(event),
    );
  }

  setPlayer(player) {
    const nextPlayer = player ?? null;
    if (nextPlayer === this.player) return;
    this.reset();
    this.player = nextPlayer;
    this.generation++;
  }

  handleInputAction({ phase, action, result }) {
    if (phase === InputActionPhases.STARTED) {
      this.begin(action);
      return;
    }
    if (phase !== InputActionPhases.COMPLETED) return;

    const context = this.findContextByInputAction(action);
    if (context) this.complete(context, result);
  }

  begin(action) {
    const inputAction = action?.inputAction;
    const player = action?.player;
    if (!player || player !== this.player) return null;

    const trackAction = resolveTrackAction(inputAction, action.playbackAction);
    if (trackAction)
      return this.createTrackActionContext(player, trackAction, action.origin);

    if (inputAction === InputActions.PLAY_PAUSE)
      return this.createPlaybackStatusContext(player, action.origin);

    const presentation = resolveImmediatePresentation(inputAction, player);
    return presentation
      ? this.createImmediateContext(player, presentation, action.origin)
      : null;
  }

  createImmediateContext(player, presentation, origin) {
    const context = {
      kind: "immediate",
      player,
      origin,
      generation: this.generation,
      presentation,
      timeoutId: null,
      active: true,
    };
    context.timeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      FEEDBACK_CONFIRMATION_TIMEOUT_MS,
      () => {
        context.timeoutId = null;
        this.removeImmediateAction(context);
        return GLib.SOURCE_REMOVE;
      },
    );
    this.pendingImmediateActions.push(context);
    return context;
  }

  createTrackActionContext(player, { playbackAction, iconName }, origin) {
    const context = {
      kind: "track",
      player,
      origin,
      playbackAction,
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

  createPlaybackStatusContext(player, origin) {
    const context = {
      kind: "playback-status",
      player,
      origin,
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
      this.removeImmediateAction(context);
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
    if (!transition.command) return;

    const context = this.pendingTrackActions.find(
      (candidate) =>
        candidate.active &&
        !candidate.transition &&
        candidate.player === transition.player &&
        candidate.playbackAction === transition.command.action &&
        candidate.origin === transition.command.origin,
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
    this.showOsd(presentation);
  }

  findContextByInputAction(action) {
    return (
      this.pendingImmediateActions.find(
        (context) => context.active && context.origin === action?.origin,
      ) ??
      this.pendingTrackActions.find(
        (context) => context.active && context.origin === action?.origin,
      ) ??
      this.pendingPlaybackStatusActions.find(
        (context) => context.active && context.origin === action?.origin,
      ) ??
      null
    );
  }

  removeContext(context) {
    if (context?.kind === "immediate") this.removeImmediateAction(context);
    else if (context?.kind === "track") this.removeTrackAction(context);
    else if (context?.kind === "playback-status")
      this.removePlaybackStatusAction(context);
  }

  removeImmediateAction(context) {
    if (!context || !context.active) return;
    context.active = false;
    if (context.timeoutId !== null) {
      GLib.Source.remove(context.timeoutId);
      context.timeoutId = null;
    }
    const index = this.pendingImmediateActions.indexOf(context);
    if (index >= 0) this.pendingImmediateActions.splice(index, 1);
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
    for (const context of [...this.pendingImmediateActions])
      this.removeImmediateAction(context);
    for (const context of [...this.pendingTrackActions])
      this.removeTrackAction(context);
    for (const context of [...this.pendingPlaybackStatusActions])
      this.removePlaybackStatusAction(context);
    this.pendingImmediateActions = [];
    this.pendingTrackActions = [];
    this.pendingPlaybackStatusActions = [];
  }

  destroy() {
    this.unsubscribeInputAction();
    this.unsubscribeInputAction = null;
    this.unsubscribeTransition();
    this.unsubscribeTransition = null;
    this.reset();
    this.player = null;
    this.generation++;
    this.inputActions = null;
    this.transitionTracker = null;
    this.showOsd = null;
  }
}
