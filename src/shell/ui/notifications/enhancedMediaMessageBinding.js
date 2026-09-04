/**
 * @file enhancedMediaMessageBinding.js
 * @module shell.ui.notifications.enhancedMediaMessageBinding
 *
 * Reversibly decorates one GNOME Shell MediaMessage with MediaShell state.
 */

import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Slider from "resource:///org/gnome/shell/ui/slider.js";

import { IconNames } from "../../../shared/icons.js";
import {
  MprisMetadataKeys,
  MprisPlayerProperties,
} from "../../mpris/protocol.js";
import { PlaybackControlIds } from "../../../shared/playback/controls.js";
import { PlaybackStatus } from "../../mpris/playbackState.js";
import { createAlbumArtRequest } from "../../media/artwork/policy.js";
import { createLogger } from "../../../shared/logging/logger.js";
import { resolvePlaybackControlState } from "../../media/playback/controlState.js";
import {
  ACTIVE_OPACITY,
  INACTIVE_OPACITY,
} from "../../constants/actorState.js";
import { ALBUM_ART_OUTLINE_WIDTH } from "../../constants/albumArt.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import { executePlaybackControlAction } from "../../mpris/playbackControlExecutor.js";
import { loadAlbumArtResult } from "../../utils/albumArtLoading.js";
import { prepareAlbumArtPixbuf } from "../../utils/albumArtPixbuf.js";
import { getAlbumArtPresentationGeometry } from "../../utils/albumArtPresentation.js";
import { placeActorAtIndex } from "../../utils/actors.js";
import { isCancellationError } from "../../utils/errors.js";
import { createIcon, setGIcon } from "../../utils/icons.js";
import { updatePlaybackControlButton } from "../../utils/playbackControlButton.js";
import {
  createPlaybackControlContent,
  updatePlaybackControlContent,
} from "../../utils/playbackControlContent.js";
import { styleClassNames } from "../../utils/styleClasses.js";

const logger = createLogger("EnhancedMediaMessageBinding");

const NATIVE_MEDIA_CONTROL_STYLE_CLASS = "message-media-control";
const EnhancedStyleClasses = Object.freeze({
  ALBUM_ART: "mediashell-enhanced-media-album-art",
  TRANSPORT: "mediashell-enhanced-media-transport",
  ACTIONS: "mediashell-enhanced-media-actions",
  CONTROL: "mediashell-enhanced-media-control",
  CONTROL_ICON: "mediashell-enhanced-media-control-icon",
  PROGRESS: "mediashell-enhanced-media-progress",
});
const PROGRESS_TRANSITION_NAME = EnhancedStyleClasses.PROGRESS;
const ENHANCED_ALBUM_ART_SIZE = 56;
const ENHANCED_ALBUM_ART_RADIUS = 8;
const STATE_CONTROL_ACTIVE_BACKGROUND_ALPHA = 0.14;
const ALBUM_ART_FALLBACK_BACKGROUND_ALPHA = 0.05;
const ALBUM_ART_FALLBACK_OUTLINE_ALPHA = 0.2;
const ALBUM_ART_FALLBACK_ICON_ALPHA = 0.5;
const STATE_CONTROL_IDS = Object.freeze([
  PlaybackControlIds.SHUFFLE,
  PlaybackControlIds.REPEAT,
]);
const CONTROL_IDS = Object.freeze([
  PlaybackControlIds.PREVIOUS,
  PlaybackControlIds.PLAY_PAUSE,
  PlaybackControlIds.NEXT,
  ...STATE_CONTROL_IDS,
]);

const OBSERVED_PLAYER_PROPERTIES = Object.freeze([
  MprisPlayerProperties.METADATA,
  MprisPlayerProperties.PLAYBACK_STATUS,
  MprisPlayerProperties.RATE,
  MprisPlayerProperties.CAN_CONTROL,
  MprisPlayerProperties.CAN_PLAY,
  MprisPlayerProperties.CAN_PAUSE,
  MprisPlayerProperties.CAN_SEEK,
  MprisPlayerProperties.CAN_GO_PREVIOUS,
  MprisPlayerProperties.CAN_GO_NEXT,
  MprisPlayerProperties.LOOP_STATUS,
  MprisPlayerProperties.SHUFFLE,
]);

function normalizePlaybackRate(value) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function normalizeTrackDurationMicroseconds(value) {
  return Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER
    ? value
    : null;
}

function colorToRgba(color, alphaScale = 1) {
  if (!color) return null;

  const red = Math.max(0, Math.min(255, Number(color.red) || 0));
  const green = Math.max(0, Math.min(255, Number(color.green) || 0));
  const blue = Math.max(0, Math.min(255, Number(color.blue) || 0));
  const alpha = Math.max(
    0,
    Math.min(1, ((Number(color.alpha) || 0) / 255) * alphaScale),
  );
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * Owns one reversible enhancement applied to a GNOME Shell MediaMessage.
 */
export default class EnhancedMediaMessageBinding {
  constructor(
    messageContext,
    mediaApp,
    { albumArtLoader, getAlbumArtCacheEnabled, onDestroyed = null },
  ) {
    this.context = messageContext;
    this.message = messageContext.message;
    this.mediaApp = mediaApp;
    this.albumArtLoader = albumArtLoader;
    this.getAlbumArtCacheEnabled = getAlbumArtCacheEnabled;
    this.onDestroyed = onDestroyed;

    this.updateSourceId = null;
    this.refreshExactPosition = false;
    this.mediaAppPropertyListeners = [];
    this.messageSignalIds = [];
    this.positionChangeDisconnect = null;
    this.nativeIconVisibilitySignalId = null;

    this.controlButtons = new Map();
    this.transportBox = null;
    this.previousButton = null;
    this.playPauseButton = null;
    this.nextButton = null;
    this.actionBox = null;
    this.slider = null;
    this.playbackTransition = null;
    this.progressAvailable = false;
    this.seekEnabled = false;
    this.dragging = false;
    this.dragTrackId = null;
    this.resumeAfterDrag = false;
    this.positionRefreshGeneration = 0;

    this.albumArtFrame = null;
    this.albumArtImage = null;
    this.albumArtFallbackActive = false;
    this.albumArtLoadGeneration = 0;
    this.albumArtLoadCancellable = null;
    this.loadingAlbumArtKey = null;
    this.loadedAlbumArtKey = null;
    this.loadedAlbumArtPixbuf = null;
    this.loadedFallbackIcon = null;
    this.preparedAlbumArt = null;
    this.fallbackAlbumArtIcon = Gio.ThemedIcon.new_from_names([
      IconNames.MEDIA,
      IconNames.MISSING,
    ]);

    this.nativeIconWasVisible = Boolean(messageContext.nativeIcon.visible);
    this.nativeMediaControlsWereVisible = Boolean(
      messageContext.nativeMediaControls.visible,
    );
    this.nativeActionArea = messageContext.getActionArea();
    this.nativeExpanded = messageContext.getExpanded();
    this.nativeExpandButtonOpacity = messageContext.getExpandButtonOpacity();
  }

  get active() {
    return Boolean(this.context && this.actionBox);
  }

  get busName() {
    return this.context?.busName ?? null;
  }

  enable() {
    if (!this.context) return false;
    if (this.actionBox) return true;

    try {
      this.createActors();
      this.connectMessageSignals();
      this.connectMediaAppState();
      this.applyNativePresentation();
      this.syncPresentation();
      if (this.message.mapped) this.syncArtwork();
      if (this.message.expanded) this.requestExactPosition();
      return true;
    } catch (error) {
      logger.warnOnce(
        `enable:${this.mediaApp?.busName ?? "unknown"}`,
        "Failed to enhance a GNOME Shell media message",
        error,
      );
      this.destroy();
      return false;
    }
  }

  createActors() {
    this.createAlbumArtActors();
    this.createPlaybackControls();
    this.createProgressTransition();
  }

  createAlbumArtActors() {
    this.albumArtImage = createIcon(
      {
        styleClass: StyleClasses.ALBUM_ART_IMAGE,
        xExpand: false,
        yExpand: false,
        xAlign: Clutter.ActorAlign.CENTER,
        yAlign: Clutter.ActorAlign.CENTER,
      },
      IconNames.MEDIA,
    );
    this.albumArtFrame = new St.Bin({
      styleClass: styleClassNames(
        StyleClasses.ALBUM_ART_FRAME,
        EnhancedStyleClasses.ALBUM_ART,
      ),
      xExpand: false,
      yExpand: false,
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.albumArtFrame.set_child(this.albumArtImage);
    this.syncAlbumArtGeometry();
    this.setAlbumArtFallback(null);
  }

  createPlaybackControls() {
    this.previousButton = this.createControlButton(PlaybackControlIds.PREVIOUS);
    this.playPauseButton = this.createControlButton(
      PlaybackControlIds.PLAY_PAUSE,
    );
    this.nextButton = this.createControlButton(PlaybackControlIds.NEXT);

    this.transportBox = new St.BoxLayout({
      styleClass: EnhancedStyleClasses.TRANSPORT,
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.transportBox.add_child(this.previousButton);
    this.transportBox.add_child(this.playPauseButton);
    this.transportBox.add_child(this.nextButton);

    this.actionBox = new St.BoxLayout({
      styleClass: EnhancedStyleClasses.ACTIONS,
      xExpand: true,
      yAlign: Clutter.ActorAlign.CENTER,
    });

    this.slider = new Slider.Slider(0);
    this.slider.add_style_class_name(EnhancedStyleClasses.PROGRESS);
    this.slider.xExpand = true;
    this.actionBox.add_child(this.slider);
    for (const controlId of STATE_CONTROL_IDS)
      this.actionBox.add_child(this.createControlButton(controlId));

    const dragBeginId = this.slider.connect("drag-begin", () => {
      if (!this.seekEnabled) return Clutter.EVENT_PROPAGATE;

      this.dragging = true;
      this.dragTrackId = this.mediaApp.trackId;
      this.resumeAfterDrag = Boolean(this.playbackTransition?.is_playing());
      this.playbackTransition?.pause();
      return Clutter.EVENT_PROPAGATE;
    });
    const dragEndId = this.slider.connect("drag-end", () => {
      this.commitSeekRequest();
      return Clutter.EVENT_PROPAGATE;
    });
    const scrollEventId = this.slider.connect(
      "scroll-event",
      () => Clutter.EVENT_STOP,
    );
    this.messageSignalIds.push(
      [this.slider, dragBeginId],
      [this.slider, dragEndId],
      [this.slider, scrollEventId],
    );

    this.syncTransportLayout(Boolean(this.message.expanded));
  }

  createControlButton(controlId) {
    const initialState = resolvePlaybackControlState(this.mediaApp, controlId);
    const controlDefinition = initialState.control;
    const button = new St.Button({
      name: `enhanced-${controlDefinition.actorName}`,
      styleClass: styleClassNames(
        NATIVE_MEDIA_CONTROL_STYLE_CLASS,
        EnhancedStyleClasses.CONTROL,
      ),
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
      toggleMode: controlDefinition.isStateControl,
    });
    const content = createPlaybackControlContent(controlDefinition, {
      iconStyleClass: EnhancedStyleClasses.CONTROL_ICON,
    });
    const buttonState = {
      button,
      content,
      action: initialState.action,
      signalId: 0,
    };
    buttonState.signalId = button.connect("clicked", () => {
      if (!button.reactive || !buttonState.action) return;
      if (controlDefinition.isStateControl)
        button.checked = resolvePlaybackControlState(
          this.mediaApp,
          controlId,
        ).isActive;
      void executePlaybackControlAction(this.mediaApp, buttonState.action);
    });
    button.set_child(content.actor);
    this.controlButtons.set(controlId, buttonState);
    return button;
  }

  createProgressTransition() {
    const initialValue = new GObject.Value();
    initialValue.init(GObject.TYPE_DOUBLE);
    initialValue.set_double(0);
    const finalValue = new GObject.Value();
    finalValue.init(GObject.TYPE_DOUBLE);
    finalValue.set_double(1);

    this.playbackTransition = new Clutter.PropertyTransition({
      propertyName: "value",
      progressMode: Clutter.AnimationMode.LINEAR,
      repeatCount: 0,
      interval: new Clutter.Interval({
        valueType: GObject.TYPE_DOUBLE,
        initial: initialValue,
        final: finalValue,
      }),
    });
    this.playbackTransition.set_remove_on_complete(false);
    this.playbackTransition.pause();
    this.slider.add_transition(
      PROGRESS_TRANSITION_NAME,
      this.playbackTransition,
    );
  }

  connectMessageSignals() {
    this.messageSignalIds.push(
      [
        this.message,
        this.message.connect("notify::mapped", () =>
          this.handleMappedChanged(),
        ),
      ],
      [
        this.message,
        this.message.connect("expanded", () => {
          this.syncTransportLayout(true);
          this.syncProgress(this.mediaApp.estimatedPositionMicroseconds);
          this.requestExactPosition();
        }),
      ],
      [
        this.message,
        this.message.connect("unexpanded", () => {
          // GNOME Shell emits `unexpanded` before assigning expanded=false.
          // Use the target state explicitly rather than reading message.expanded.
          this.syncTransportLayout(false);
          this.pauseProgressTransition();
        }),
      ],
      [
        this.message,
        this.message.connect("destroy", () =>
          this.handleNativeMessageDestroyed(),
        ),
      ],
    );

    this.messageSignalIds.push([
      this.context.themeSource,
      this.context.themeSource.connect("style-changed", () => {
        this.syncSeekTheme();
        this.syncStateControlStyles();
        if (this.albumArtFallbackActive) this.syncAlbumArtGeometry();
      }),
    ]);
  }

  connectMediaAppState() {
    for (const property of OBSERVED_PLAYER_PROPERTIES) {
      const listenerId = this.mediaApp.onPropertyChanged(property, () => {
        if (property === MprisPlayerProperties.METADATA)
          this.refreshExactPosition = true;
        this.schedulePresentationSync();
      });
      if (listenerId)
        this.mediaAppPropertyListeners.push({ property, listenerId });
    }

    this.positionChangeDisconnect = this.mediaApp.onPositionChanged(
      (positionMicroseconds) => {
        if (!this.active || this.dragging) return;
        this.syncProgress(positionMicroseconds);
      },
    );
  }

  applyNativePresentation() {
    this.context.insertBeforeNativeIcon(this.albumArtFrame);
    this.context.insertBeforeNativeMediaControls(this.transportBox);
    this.context.setActionArea(this.actionBox);

    this.context.nativeIcon.visible = false;
    this.context.nativeMediaControls.visible = false;
    this.context.setExpandButtonOpacity(ACTIVE_OPACITY);
    this.nativeIconVisibilitySignalId = this.context.nativeIcon.connect(
      "notify::visible",
      () => {
        if (this.active && this.context.nativeIcon.visible)
          this.context.nativeIcon.visible = false;
      },
    );
    this.context.requestPresentationUpdate();
  }

  schedulePresentationSync() {
    if (!this.active || this.updateSourceId !== null) return;

    this.updateSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this.updateSourceId = null;
      if (!this.active) return GLib.SOURCE_REMOVE;

      this.syncPresentation();
      if (
        this.refreshExactPosition &&
        this.message?.mapped &&
        this.message.expanded
      )
        this.requestExactPosition();
      this.refreshExactPosition = false;
      return GLib.SOURCE_REMOVE;
    });
  }

  syncPresentation() {
    if (!this.active) return;

    for (const controlId of CONTROL_IDS) this.syncControl(controlId);
    this.syncProgress(this.mediaApp.estimatedPositionMicroseconds);
    this.syncSeekTheme();
    this.context.setExpandButtonOpacity(ACTIVE_OPACITY);
    if (this.message.mapped) this.syncArtwork();
    this.context.requestPresentationUpdate();
  }

  syncControl(controlId) {
    const buttonState = this.controlButtons.get(controlId);
    if (!buttonState) return;

    const controlState = resolvePlaybackControlState(this.mediaApp, controlId);
    const isVisible = this.isControlVisible(controlId);

    buttonState.action = controlState.action;
    updatePlaybackControlContent(buttonState.content, controlState);
    updatePlaybackControlButton(
      buttonState.button,
      this.mediaApp,
      controlState,
      _,
    );

    buttonState.button.visible = isVisible;
    buttonState.button.opacity = controlState.isReactive
      ? ACTIVE_OPACITY
      : INACTIVE_OPACITY;

    if (!isVisible) {
      buttonState.button.reactive = false;
      buttonState.button.canFocus = false;
    }

    if (controlState.control.isStateControl)
      this.syncStateControlStyle(buttonState.button, controlState, isVisible);
  }

  isControlVisible(controlId) {
    if (controlId === PlaybackControlIds.REPEAT)
      return this.mediaApp.canSetLoopStatus;
    if (controlId === PlaybackControlIds.SHUFFLE)
      return this.mediaApp.canSetShuffle;
    return true;
  }

  syncStateControlStyle(button, controlState, isVisible = true) {
    const selectedBackground = colorToRgba(
      this.context.getForegroundColor(),
      STATE_CONTROL_ACTIVE_BACKGROUND_ALPHA,
    );
    button.style =
      isVisible && controlState.isActive && selectedBackground
        ? `background-color: ${selectedBackground};`
        : "";
  }

  syncStateControlStyles() {
    for (const controlId of STATE_CONTROL_IDS) {
      const buttonState = this.controlButtons.get(controlId);
      if (!buttonState) continue;

      const controlState = resolvePlaybackControlState(
        this.mediaApp,
        controlId,
      );
      this.syncStateControlStyle(
        buttonState.button,
        controlState,
        this.isControlVisible(controlId),
      );
    }
  }

  syncTransportLayout(expanded) {
    if (
      !this.transportBox ||
      !this.actionBox ||
      !this.previousButton ||
      !this.playPauseButton ||
      !this.nextButton
    )
      return;

    if (expanded) {
      placeActorAtIndex(this.previousButton, this.actionBox, 0);
      placeActorAtIndex(this.nextButton, this.actionBox, 2);
    } else {
      placeActorAtIndex(this.previousButton, this.transportBox, 0);
      placeActorAtIndex(this.playPauseButton, this.transportBox, 1);
      placeActorAtIndex(this.nextButton, this.transportBox, 2);
    }

    this.context.requestPresentationUpdate();
  }

  syncSeekTheme() {
    if (!this.slider || !this.context) return;

    const activeColor = colorToRgba(this.context.getForegroundColor());
    this.slider.style = activeColor
      ? `color: ${activeColor}; -barlevel-active-background-color: ${activeColor};`
      : "";
  }

  getCurrentTrackDurationMicroseconds() {
    return normalizeTrackDurationMicroseconds(
      this.mediaApp.metadata[MprisMetadataKeys.LENGTH],
    );
  }

  syncProgress(positionMicroseconds) {
    if (!this.active) return;

    const durationMicroseconds = this.getCurrentTrackDurationMicroseconds();
    const hasValidPosition =
      Number.isFinite(positionMicroseconds) && positionMicroseconds >= 0;
    this.progressAvailable = Boolean(durationMicroseconds && hasValidPosition);
    this.seekEnabled = Boolean(
      this.progressAvailable && this.mediaApp.canSetPosition,
    );

    this.slider.reactive = this.seekEnabled;
    this.slider.opacity = this.seekEnabled ? ACTIVE_OPACITY : INACTIVE_OPACITY;

    if (!this.progressAvailable) {
      this.dragging = false;
      this.dragTrackId = null;
      this.resumeAfterDrag = false;
      this.pauseProgressTransition();
      this.playbackTransition.set_duration(1);
      this.slider.value = 0;
      return;
    }

    if (!this.dragging)
      this.setProgressPosition(
        Math.min(positionMicroseconds, durationMicroseconds),
        durationMicroseconds,
        this.mediaApp.rate,
      );

    this.reconcileProgressTransition();
  }

  setProgressPosition(
    positionMicroseconds,
    durationMicroseconds,
    playbackRate,
  ) {
    const rate = normalizePlaybackRate(playbackRate);
    const durationMilliseconds = Math.max(1, durationMicroseconds / 1000);
    const timelineDurationMilliseconds = Math.max(
      1,
      Math.round(durationMilliseconds / rate),
    );
    const positionMilliseconds = Math.min(
      durationMilliseconds,
      Math.max(0, positionMicroseconds / 1000),
    );
    const timelinePositionMilliseconds = Math.min(
      timelineDurationMilliseconds,
      positionMilliseconds / rate,
    );

    this.ensureProgressTransitionAttached();
    this.playbackTransition.set_duration(timelineDurationMilliseconds);
    this.slider.value = Math.min(
      1,
      positionMilliseconds / durationMilliseconds,
    );
    this.playbackTransition.advance(timelinePositionMilliseconds);
  }

  ensureProgressTransitionAttached() {
    if (this.slider.get_transition(PROGRESS_TRANSITION_NAME) === null)
      this.slider.add_transition(
        PROGRESS_TRANSITION_NAME,
        this.playbackTransition,
      );
  }

  reconcileProgressTransition() {
    if (
      this.progressAvailable &&
      !this.dragging &&
      this.message?.mapped &&
      this.message.expanded &&
      this.mediaApp.playbackStatus === PlaybackStatus.PLAYING
    ) {
      this.ensureProgressTransitionAttached();
      if (!this.playbackTransition.is_playing())
        this.playbackTransition.start();
      return;
    }

    this.pauseProgressTransition();
  }

  pauseProgressTransition() {
    this.playbackTransition?.pause();
  }

  commitSeekRequest() {
    const shouldResume = this.resumeAfterDrag;
    const dragTrackId = this.dragTrackId;
    this.dragging = false;
    this.dragTrackId = null;
    this.resumeAfterDrag = false;

    const currentTrackId = this.mediaApp.trackId;
    const durationMicroseconds = this.getCurrentTrackDurationMicroseconds();
    if (
      !this.seekEnabled ||
      !dragTrackId ||
      dragTrackId !== currentTrackId ||
      !durationMicroseconds
    ) {
      this.syncProgress(this.mediaApp.estimatedPositionMicroseconds);
      return;
    }

    const requestedPositionMicroseconds = Math.floor(
      Math.min(1, Math.max(0, this.slider.value)) * durationMicroseconds,
    );
    void Promise.resolve(
      this.mediaApp.setPosition(currentTrackId, requestedPositionMicroseconds),
    )
      .catch((error) =>
        logger.debugOnce(
          `seek:${this.mediaApp.busName}`,
          "Enhanced media seek failed",
          error,
        ),
      )
      .finally(() => {
        if (this.active) this.requestExactPosition();
      });

    if (shouldResume) this.reconcileProgressTransition();
  }

  requestExactPosition() {
    if (
      !this.active ||
      !this.message.mapped ||
      !this.message.expanded ||
      !this.progressAvailable
    )
      return;

    const refreshGeneration = ++this.positionRefreshGeneration;
    const mediaApp = this.mediaApp;
    void mediaApp.positionMicroseconds
      .then((positionMicroseconds) => {
        if (
          !this.active ||
          refreshGeneration !== this.positionRefreshGeneration ||
          mediaApp !== this.mediaApp ||
          this.dragging
        )
          return;
        this.syncProgress(positionMicroseconds);
      })
      .catch((error) =>
        logger.debugOnce(
          `exact-position:${mediaApp.busName}`,
          "Could not read exact position for an enhanced media message",
          error,
        ),
      );
  }

  handleMappedChanged() {
    if (!this.active) return;

    if (!this.message.mapped) {
      this.cancelAlbumArtLoad();
      this.pauseProgressTransition();
      return;
    }

    this.syncPresentation();
    this.syncSeekTheme();
    if (this.message.expanded) this.requestExactPosition();
  }

  syncAlbumArtGeometry() {
    if (!this.albumArtFrame || !this.albumArtImage) return;
    const { frameSize, frameRadius, imageSize, imageRadius } =
      getAlbumArtPresentationGeometry(
        ENHANCED_ALBUM_ART_SIZE,
        ENHANCED_ALBUM_ART_RADIUS,
      );
    const frameStyle = [
      `border-radius: ${frameRadius}px;`,
      `padding: ${ALBUM_ART_OUTLINE_WIDTH}px;`,
    ];
    const imageStyle = [`border-radius: ${imageRadius}px;`];

    if (this.albumArtFallbackActive) {
      const foreground = this.context.getForegroundColor();
      const outlineColor = colorToRgba(
        foreground,
        ALBUM_ART_FALLBACK_OUTLINE_ALPHA,
      );
      const backgroundColor = colorToRgba(
        foreground,
        ALBUM_ART_FALLBACK_BACKGROUND_ALPHA,
      );
      const iconColor = colorToRgba(foreground, ALBUM_ART_FALLBACK_ICON_ALPHA);
      if (outlineColor && backgroundColor && iconColor) {
        frameStyle.push(`background-color: ${outlineColor};`);
        imageStyle.push(
          `background-color: ${backgroundColor};`,
          `color: ${iconColor};`,
        );
      }
    }

    this.albumArtFrame.style = frameStyle.join(" ");
    this.albumArtFrame.set_size(frameSize, frameSize);
    this.albumArtImage.style = imageStyle.join(" ");
    this.albumArtImage.set_size(imageSize, imageSize);
  }

  syncArtwork() {
    if (!this.message?.mapped || !this.albumArtFrame) return;

    const request = createAlbumArtRequest({
      busName: this.mediaApp.busName,
      metadata: this.mediaApp.metadata,
      width: ENHANCED_ALBUM_ART_SIZE,
      radius: ENHANCED_ALBUM_ART_RADIUS,
      cacheEnabled: Boolean(this.getAlbumArtCacheEnabled()),
    });

    if (this.loadedAlbumArtKey === request.key) {
      this.syncLoadedAlbumArt();
      return;
    }
    if (this.loadingAlbumArtKey === request.key) return;

    this.cancelAlbumArtLoad();
    this.loadAlbumArt(request);
  }

  async loadAlbumArt(request) {
    const loadGeneration = ++this.albumArtLoadGeneration;
    const loadCancellable = new Gio.Cancellable();
    this.albumArtLoadCancellable = loadCancellable;
    this.loadingAlbumArtKey = request.key;

    try {
      const { pixbuf, fallbackIcon } = await loadAlbumArtResult({
        albumArtLoader: this.albumArtLoader,
        request,
        loadCancellable,
      });
      if (!this.isCurrentAlbumArtLoad(loadGeneration, loadCancellable, request))
        return;

      this.loadedAlbumArtKey = request.key;
      this.loadedAlbumArtPixbuf = pixbuf ?? null;
      this.loadedFallbackIcon = pixbuf ? null : (fallbackIcon ?? null);
      this.preparedAlbumArt = null;
      this.syncLoadedAlbumArt();
    } catch (error) {
      if (
        !isCancellationError(error) &&
        this.isCurrentAlbumArtLoad(loadGeneration, loadCancellable, request)
      ) {
        logger.warnOnce(
          `album-art:${request.busName}`,
          "Enhanced media artwork could not be processed; using the fallback icon",
          error,
        );
        this.loadedAlbumArtKey = request.key;
        this.loadedAlbumArtPixbuf = null;
        this.loadedFallbackIcon = null;
        this.preparedAlbumArt = null;
        this.syncLoadedAlbumArt();
      }
    } finally {
      if (
        this.isCurrentAlbumArtLoad(loadGeneration, loadCancellable, request)
      ) {
        this.loadingAlbumArtKey = null;
        this.albumArtLoadCancellable = null;
      }
    }
  }

  syncLoadedAlbumArt() {
    if (!this.albumArtFrame || !this.loadedAlbumArtKey) return;

    if (this.loadedAlbumArtPixbuf)
      this.setAlbumArtPixbuf(this.loadedAlbumArtPixbuf);
    else this.setAlbumArtFallback(this.loadedFallbackIcon);
  }

  setAlbumArtPixbuf(pixbuf) {
    const { imageSize, imageRadius } = getAlbumArtPresentationGeometry(
      ENHANCED_ALBUM_ART_SIZE,
      ENHANCED_ALBUM_ART_RADIUS,
    );
    if (
      this.preparedAlbumArt?.key !== this.loadedAlbumArtKey ||
      this.preparedAlbumArt.imageSize !== imageSize ||
      this.preparedAlbumArt.imageRadius !== imageRadius
    ) {
      this.preparedAlbumArt = {
        key: this.loadedAlbumArtKey,
        imageSize,
        imageRadius,
        pixbuf: prepareAlbumArtPixbuf(pixbuf, imageSize, imageRadius),
      };
    }

    this.albumArtFallbackActive = false;
    this.syncAlbumArtGeometry();
    this.albumArtImage.content = null;
    setGIcon(this.albumArtImage, this.preparedAlbumArt.pixbuf, IconNames.MEDIA);
    this.albumArtImage.set_icon_size(imageSize);
    this.albumArtFrame.opacity = ACTIVE_OPACITY;
  }

  setAlbumArtFallback(icon) {
    if (!this.albumArtFrame || !this.albumArtImage) return;
    const { imageSize, fallbackIconSize } = getAlbumArtPresentationGeometry(
      ENHANCED_ALBUM_ART_SIZE,
      ENHANCED_ALBUM_ART_RADIUS,
    );
    this.albumArtFallbackActive = true;
    this.syncAlbumArtGeometry();
    this.albumArtImage.content = null;
    setGIcon(
      this.albumArtImage,
      icon ?? this.fallbackAlbumArtIcon,
      IconNames.MEDIA,
    );
    this.albumArtImage.set_icon_size(fallbackIconSize);
    this.albumArtImage.set_size(imageSize, imageSize);
    this.albumArtFrame.opacity = ACTIVE_OPACITY;
  }

  isCurrentAlbumArtLoad(loadGeneration, loadCancellable, request) {
    return (
      this.active &&
      this.message.mapped &&
      loadGeneration === this.albumArtLoadGeneration &&
      !loadCancellable.is_cancelled() &&
      this.loadingAlbumArtKey === request.key &&
      this.mediaApp?.busName === request.busName
    );
  }

  cancelAlbumArtLoad() {
    if (!this.albumArtLoadCancellable) return;
    this.albumArtLoadGeneration++;
    this.albumArtLoadCancellable.cancel();
    this.albumArtLoadCancellable = null;
    this.loadingAlbumArtKey = null;
  }

  handleNativeMessageDestroyed() {
    if (!this.context) return;
    const onDestroyed = this.onDestroyed;
    this.destroy({ restoreNative: false });
    onDestroyed?.(this);
  }

  disconnectNativePresentationSignals() {
    if (this.nativeIconVisibilitySignalId === null || !this.context) return;

    this.context.nativeIcon.disconnect(this.nativeIconVisibilitySignalId);
    this.nativeIconVisibilitySignalId = null;
  }

  disconnectMessageSignals() {
    for (const [object, signalId] of this.messageSignalIds.splice(0))
      object.disconnect(signalId);
  }

  disconnectMediaAppState() {
    for (const { property, listenerId } of this.mediaAppPropertyListeners)
      this.mediaApp.removePropertyChangeListener(property, listenerId);
    this.mediaAppPropertyListeners = [];
    if (this.positionChangeDisconnect) this.positionChangeDisconnect();
    this.positionChangeDisconnect = null;
  }

  restoreNativePresentation() {
    if (!this.context) return;

    try {
      const actionAreaIsOurs = this.context.getActionArea() === this.actionBox;

      if (actionAreaIsOurs && !this.nativeExpanded)
        this.context.setExpanded(false);
      if (actionAreaIsOurs) this.context.setActionArea(this.nativeActionArea);
      if (this.context.getExpanded() !== this.nativeExpanded)
        this.context.setExpanded(this.nativeExpanded);

      this.context.nativeIcon.visible = this.nativeIconWasVisible;
      this.context.nativeMediaControls.visible =
        this.nativeMediaControlsWereVisible;
      if (Number.isFinite(this.nativeExpandButtonOpacity))
        this.context.setExpandButtonOpacity(this.nativeExpandButtonOpacity);
      this.context.refreshExpandButton();
    } catch (error) {
      logger.debugOnce(
        `restore:${this.mediaApp?.busName ?? "unknown"}`,
        "Native media-message presentation could not be fully restored",
        error,
      );
    }
  }

  destroy({ restoreNative = true } = {}) {
    if (!this.context) return;
    this.positionRefreshGeneration++;

    if (this.updateSourceId !== null) {
      GLib.Source.remove(this.updateSourceId);
      this.updateSourceId = null;
    }
    this.cancelAlbumArtLoad();
    this.pauseProgressTransition();
    this.disconnectMediaAppState();
    this.disconnectNativePresentationSignals();
    this.disconnectMessageSignals();

    if (restoreNative) this.restoreNativePresentation();

    for (const buttonState of this.controlButtons.values())
      buttonState.button.disconnect(buttonState.signalId);
    this.controlButtons.clear();

    if (this.playbackTransition) this.playbackTransition.stop();
    if (this.slider) this.slider.remove_transition(PROGRESS_TRANSITION_NAME);

    for (const actor of [
      this.actionBox,
      this.transportBox,
      this.albumArtFrame,
    ]) {
      if (!actor) continue;
      actor.get_parent()?.remove_child(actor);
      actor.destroy();
    }

    this.context = null;
    this.message = null;
    this.mediaApp = null;
    this.albumArtLoader = null;
    this.getAlbumArtCacheEnabled = null;
    this.onDestroyed = null;
    this.transportBox = null;
    this.previousButton = null;
    this.playPauseButton = null;
    this.nextButton = null;
    this.actionBox = null;
    this.slider = null;
    this.playbackTransition = null;
    this.albumArtFrame = null;
    this.albumArtImage = null;
    this.albumArtFallbackActive = false;
    this.loadedAlbumArtPixbuf = null;
    this.loadedFallbackIcon = null;
    this.preparedAlbumArt = null;
    this.fallbackAlbumArtIcon = null;
  }
}
