/**
 * @file notificationBannerBinding.js
 * @module shell.private.gnome.nativecontrols.notificationBannerBinding
 *
 * Owns the reversible presentation binding between one private GNOME Shell
 * notification banner and one canonical MprisPlayer. Protocol state and
 * operations are consumed from MediaShell; this class owns only native
 * notification banner presentation.
 */

import { MediaShellStyleClasses, styleClassNames } from "../../../ui/style.js";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Slider from "resource:///org/gnome/shell/ui/slider.js";

import { IconNames } from "../../../../shared/icons.js";
import { MprisPlayerProperties } from "../../../mpris/protocol.js";
import { MprisOperationStatuses } from "../../../mpris/operationResult.js";
import { PlaybackControlIds } from "../../../../shared/playback/controls.js";
import { PlaybackStatus } from "../../../mpris/protocol.js";
import { normalizeTrackDurationMicroseconds } from "../../../mpris/position.js";
import { resolvePlaybackProgress } from "../../../media/playback/progress.js";
import { createArtworkRequest } from "../../../media/artwork/request.js";
import {
  ARTWORK_OUTLINE_WIDTH,
  getArtworkPresentationGeometry,
  prepareArtworkPixbuf,
} from "../../../media/artwork/presentation.js";
import { createLogger } from "../../../../shared/logging/logger.js";
import { resolvePlaybackControlState } from "../../../media/playback/controlState.js";
import { ACTIVE_OPACITY, INACTIVE_OPACITY } from "../../../ui/actorState.js";
import { placeActorAtIndex } from "../../../ui/components/actorOrder.js";
import { isCancellationError } from "../../../platform/gioErrors.js";
import { createIcon, setGIcon } from "../../../ui/icons.js";
import { updatePlaybackControlButton } from "../../../ui/components/playback/button.js";
import {
  createPlaybackControlContent,
  updatePlaybackControlContent,
} from "../../../ui/components/playback/content.js";

const logger = createLogger("EnhanceNotificationBannerBinding");

const NATIVE_CONTROL_STYLE_CLASS = "message-media-control";
const EnhanceStyleClasses = Object.freeze({
  ARTWORK: "mediashell-enhance-media-artwork",
  TRANSPORT: "mediashell-enhance-media-transport",
  ACTIONS: "mediashell-enhance-media-actions",
  CONTROL: "mediashell-enhance-media-control",
  CONTROL_ICON: "mediashell-enhance-media-control-icon",
  PROGRESS: "mediashell-enhance-media-progress",
});
const PROGRESS_TRANSITION_NAME = EnhanceStyleClasses.PROGRESS;
const ENHANCE_ARTWORK_SIZE = 56;
const ENHANCE_ARTWORK_RADIUS = 8;
const STATE_CONTROL_ACTIVE_BACKGROUND_ALPHA = 0.14;
const ARTWORK_FALLBACK_BACKGROUND_ALPHA = 0.05;
const ARTWORK_FALLBACK_OUTLINE_ALPHA = 0.2;
const ARTWORK_FALLBACK_ICON_ALPHA = 0.5;
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
 * Owns one reversible Enhance binding applied to a GNOME Shell notification banner.
 */
export default class EnhanceNotificationBannerBinding {
  constructor(
    bannerContext,
    player,
    { artworkService, playbackController, onDestroyed = null },
  ) {
    this.context = bannerContext;
    this.banner = bannerContext.banner;
    this.player = player;
    this.artworkService = artworkService;
    this.playbackController = playbackController;
    this.onDestroyed = onDestroyed;

    this.updateSourceId = null;
    this.refreshExactPosition = false;
    this.playerPropertyListeners = [];
    this.bannerSignalIds = [];
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

    this.artworkFrame = null;
    this.artworkImage = null;
    this.artworkFallbackActive = false;
    this.artworkLoadGeneration = 0;
    this.artworkLoadCancellable = null;
    this.loadingArtworkKey = null;
    this.loadedArtworkKey = null;
    this.loadedArtworkPixbuf = null;
    this.loadedFallbackIcon = null;
    this.preparedArtwork = null;
    this.fallbackArtworkIcon = Gio.ThemedIcon.new_from_names([
      IconNames.MEDIA,
      IconNames.MISSING,
    ]);

    this.nativeIconWasVisible = Boolean(bannerContext.nativeIcon.visible);
    this.nativeControlsWereVisible = Boolean(
      bannerContext.nativeControls.visible,
    );
    this.nativeActionArea = bannerContext.getActionArea();
    this.nativeExpanded = bannerContext.getExpanded();
    this.nativeExpandButtonOpacity = bannerContext.getExpandButtonOpacity();
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
      this.connectBannerSignals();
      this.connectPlayerState();
      this.applyNativePresentation();
      this.syncPresentation();
      if (this.banner.mapped) this.syncArtwork();
      if (this.banner.expanded) this.requestExactPosition();
      return true;
    } catch (error) {
      logger.warnOnce(
        `enable:${this.player?.busName ?? "unknown"}`,
        "Failed to apply Enhance to a GNOME Shell notification banner",
        error,
      );
      this.destroy();
      return false;
    }
  }

  createActors() {
    this.createArtworkActors();
    this.createPlaybackControls();
    this.createProgressTransition();
  }

  createArtworkActors() {
    this.artworkImage = createIcon(
      {
        styleClass: MediaShellStyleClasses.ARTWORK_IMAGE,
        xExpand: false,
        yExpand: false,
        xAlign: Clutter.ActorAlign.CENTER,
        yAlign: Clutter.ActorAlign.CENTER,
      },
      IconNames.MEDIA,
    );
    this.artworkFrame = new St.Bin({
      styleClass: styleClassNames(
        MediaShellStyleClasses.ARTWORK_FRAME,
        EnhanceStyleClasses.ARTWORK,
      ),
      xExpand: false,
      yExpand: false,
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.artworkFrame.set_child(this.artworkImage);
    this.syncArtworkGeometry();
    this.setArtworkFallback(null);
  }

  createPlaybackControls() {
    this.previousButton = this.createControlButton(PlaybackControlIds.PREVIOUS);
    this.playPauseButton = this.createControlButton(
      PlaybackControlIds.PLAY_PAUSE,
    );
    this.nextButton = this.createControlButton(PlaybackControlIds.NEXT);

    this.transportBox = new St.BoxLayout({
      styleClass: EnhanceStyleClasses.TRANSPORT,
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.transportBox.add_child(this.previousButton);
    this.transportBox.add_child(this.playPauseButton);
    this.transportBox.add_child(this.nextButton);

    this.actionBox = new St.BoxLayout({
      styleClass: EnhanceStyleClasses.ACTIONS,
      xExpand: true,
      yAlign: Clutter.ActorAlign.CENTER,
    });

    this.slider = new Slider.Slider(0);
    this.slider.add_style_class_name(EnhanceStyleClasses.PROGRESS);
    this.slider.xExpand = true;
    this.actionBox.add_child(this.slider);
    for (const controlId of STATE_CONTROL_IDS)
      this.actionBox.add_child(this.createControlButton(controlId));

    const dragBeginId = this.slider.connect("drag-begin", () => {
      if (!this.seekEnabled) return Clutter.EVENT_PROPAGATE;

      this.dragging = true;
      this.dragTrackId = this.player.trackId;
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
    this.bannerSignalIds.push(
      [this.slider, dragBeginId],
      [this.slider, dragEndId],
      [this.slider, scrollEventId],
    );

    this.syncTransportLayout(Boolean(this.banner.expanded));
  }

  createControlButton(controlId) {
    const initialState = resolvePlaybackControlState(this.player, controlId);
    const controlDefinition = initialState.control;
    const button = new St.Button({
      name: `enhance-${controlDefinition.actorName}`,
      styleClass: styleClassNames(
        NATIVE_CONTROL_STYLE_CLASS,
        EnhanceStyleClasses.CONTROL,
      ),
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
      toggleMode: controlDefinition.isStateControl,
    });
    const content = createPlaybackControlContent(controlDefinition, {
      iconStyleClass: EnhanceStyleClasses.CONTROL_ICON,
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
          this.player,
          controlId,
        ).isActive;
      void this.playbackController.execute(buttonState.action, this.player);
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

  connectBannerSignals() {
    this.bannerSignalIds.push(
      [
        this.banner,
        this.banner.connect("notify::mapped", () =>
          this.handleMappedChanged(),
        ),
      ],
      [
        this.banner,
        this.banner.connect("expanded", () => {
          this.syncTransportLayout(true);
          this.syncProgress(this.player.estimatedPositionMicroseconds);
          this.requestExactPosition();
        }),
      ],
      [
        this.banner,
        this.banner.connect("unexpanded", () => {
          // GNOME Shell emits `unexpanded` before assigning expanded=false.
          // Use the target state explicitly rather than reading banner.expanded.
          this.syncTransportLayout(false);
          this.pauseProgressTransition();
        }),
      ],
      [
        this.banner,
        this.banner.connect("destroy", () =>
          this.handleNativeBannerDestroyed(),
        ),
      ],
    );

    this.bannerSignalIds.push([
      this.context.themeSource,
      this.context.themeSource.connect("style-changed", () => {
        this.syncSeekTheme();
        this.syncStateControlStyles();
        if (this.artworkFallbackActive) this.syncArtworkGeometry();
      }),
    ]);
  }

  connectPlayerState() {
    for (const property of OBSERVED_PLAYER_PROPERTIES) {
      const listenerId = this.player.onPropertyChanged(property, () => {
        if (property === MprisPlayerProperties.METADATA)
          this.refreshExactPosition = true;
        this.schedulePresentationSync();
      });
      if (listenerId)
        this.playerPropertyListeners.push({ property, listenerId });
    }

    this.positionChangeDisconnect = this.player.onPositionChanged(
      (positionMicroseconds) => {
        if (!this.active || this.dragging) return;
        this.syncProgress(positionMicroseconds);
      },
    );
  }

  applyNativePresentation() {
    this.context.insertBeforeNativeIcon(this.artworkFrame);
    this.context.insertBeforeNativeControls(this.transportBox);
    this.context.setActionArea(this.actionBox);

    this.context.nativeIcon.visible = false;
    this.context.nativeControls.visible = false;
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
        this.banner?.mapped &&
        this.banner.expanded
      )
        this.requestExactPosition();
      this.refreshExactPosition = false;
      return GLib.SOURCE_REMOVE;
    });
  }

  syncPresentation() {
    if (!this.active) return;

    for (const controlId of CONTROL_IDS) this.syncControl(controlId);
    this.syncProgress(this.player.estimatedPositionMicroseconds);
    this.syncSeekTheme();
    this.context.setExpandButtonOpacity(ACTIVE_OPACITY);
    if (this.banner.mapped) this.syncArtwork();
    this.context.requestPresentationUpdate();
  }

  syncControl(controlId) {
    const buttonState = this.controlButtons.get(controlId);
    if (!buttonState) return;

    const controlState = resolvePlaybackControlState(this.player, controlId);
    const isVisible = this.isControlVisible(controlId);

    buttonState.action = controlState.action;
    updatePlaybackControlContent(buttonState.content, controlState);
    updatePlaybackControlButton(
      buttonState.button,
      this.player,
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
      return this.player.canSetLoopStatus;
    if (controlId === PlaybackControlIds.SHUFFLE)
      return this.player.canSetShuffle;
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

      const controlState = resolvePlaybackControlState(this.player, controlId);
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
      this.player.track.lengthMicroseconds,
    );
  }

  syncProgress(positionMicroseconds) {
    if (!this.active) return;

    const progress = resolvePlaybackProgress(
      positionMicroseconds,
      this.getCurrentTrackDurationMicroseconds(),
      this.player.rate,
    );
    this.progressAvailable = progress !== null;
    this.seekEnabled = Boolean(
      this.progressAvailable && this.player.canSetPosition,
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

    if (!this.dragging) this.setProgressPosition(progress);

    this.reconcileProgressTransition();
  }

  setProgressPosition(progress) {
    this.ensureProgressTransitionAttached();
    this.playbackTransition.set_duration(progress.timelineDurationMilliseconds);
    this.slider.value = progress.fraction;
    this.playbackTransition.advance(progress.timelinePositionMilliseconds);
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
      this.banner?.mapped &&
      this.banner.expanded &&
      this.player.playbackStatus === PlaybackStatus.PLAYING
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

    const currentTrackId = this.player.trackId;
    const durationMicroseconds = this.getCurrentTrackDurationMicroseconds();
    if (
      !this.seekEnabled ||
      !dragTrackId ||
      dragTrackId !== currentTrackId ||
      !durationMicroseconds
    ) {
      this.syncProgress(this.player.estimatedPositionMicroseconds);
      return;
    }

    const requestedPositionMicroseconds = Math.floor(
      Math.min(1, Math.max(0, this.slider.value)) * durationMicroseconds,
    );
    void this.commitAbsoluteSeek(requestedPositionMicroseconds, currentTrackId);

    if (shouldResume) this.reconcileProgressTransition();
  }

  async commitAbsoluteSeek(positionMicroseconds, trackId) {
    const player = this.player;
    const result = await this.playbackController.setPosition(
      positionMicroseconds,
      player,
      trackId,
    );
    if (!this.active || this.player !== player) return;

    if (result.status !== MprisOperationStatuses.SUCCESS) {
      logger.debugOnce(
        `seek:${player.busName}:${result.reason}`,
        "Enhance notification banner seek was not applied",
        result.reason,
        result.errorName ?? "",
      );
    }
    this.requestExactPosition();
  }

  requestExactPosition() {
    if (
      !this.active ||
      !this.banner.mapped ||
      !this.banner.expanded ||
      !this.progressAvailable
    )
      return;

    const refreshGeneration = ++this.positionRefreshGeneration;
    const player = this.player;
    void player.positionMicroseconds
      .then((positionMicroseconds) => {
        if (
          !this.active ||
          refreshGeneration !== this.positionRefreshGeneration ||
          player !== this.player ||
          this.dragging
        )
          return;
        this.syncProgress(positionMicroseconds);
      })
      .catch((error) =>
        logger.debugOnce(
          `exact-position:${player.busName}`,
          "Could not read exact position for an Enhance notification banner",
          error,
        ),
      );
  }

  handleMappedChanged() {
    if (!this.active) return;

    if (!this.banner.mapped) {
      this.cancelArtworkLoad();
      this.pauseProgressTransition();
      return;
    }

    this.syncPresentation();
    this.syncSeekTheme();
    if (this.banner.expanded) this.requestExactPosition();
  }

  syncArtworkGeometry() {
    if (!this.artworkFrame || !this.artworkImage) return;
    const { frameSize, frameRadius, imageSize, imageRadius } =
      getArtworkPresentationGeometry(
        ENHANCE_ARTWORK_SIZE,
        ENHANCE_ARTWORK_RADIUS,
      );
    const frameStyle = [
      `border-radius: ${frameRadius}px;`,
      `padding: ${ARTWORK_OUTLINE_WIDTH}px;`,
    ];
    const imageStyle = [`border-radius: ${imageRadius}px;`];

    if (this.artworkFallbackActive) {
      const foreground = this.context.getForegroundColor();
      const outlineColor = colorToRgba(
        foreground,
        ARTWORK_FALLBACK_OUTLINE_ALPHA,
      );
      const backgroundColor = colorToRgba(
        foreground,
        ARTWORK_FALLBACK_BACKGROUND_ALPHA,
      );
      const iconColor = colorToRgba(foreground, ARTWORK_FALLBACK_ICON_ALPHA);
      if (outlineColor && backgroundColor && iconColor) {
        frameStyle.push(`background-color: ${outlineColor};`);
        imageStyle.push(
          `background-color: ${backgroundColor};`,
          `color: ${iconColor};`,
        );
      }
    }

    this.artworkFrame.style = frameStyle.join(" ");
    this.artworkFrame.set_size(frameSize, frameSize);
    this.artworkImage.style = imageStyle.join(" ");
    this.artworkImage.set_size(imageSize, imageSize);
  }

  syncArtwork() {
    if (!this.banner?.mapped || !this.artworkFrame) return;

    const request = createArtworkRequest({
      busName: this.player.busName,
      track: this.player.track,
      width: ENHANCE_ARTWORK_SIZE,
      radius: ENHANCE_ARTWORK_RADIUS,
    });

    if (this.loadedArtworkKey === request.key) {
      this.syncLoadedArtwork();
      return;
    }
    if (this.loadingArtworkKey === request.key) return;

    this.cancelArtworkLoad();
    this.loadArtwork(request);
  }

  async loadArtwork(request) {
    const loadGeneration = ++this.artworkLoadGeneration;
    const loadCancellable = new Gio.Cancellable();
    this.artworkLoadCancellable = loadCancellable;
    this.loadingArtworkKey = request.key;

    try {
      const { pixbuf, fallbackIcon } = await this.artworkService.load(
        request,
        loadCancellable,
      );
      if (!this.isCurrentArtworkLoad(loadGeneration, loadCancellable, request))
        return;

      this.loadedArtworkKey = request.key;
      this.loadedArtworkPixbuf = pixbuf ?? null;
      this.loadedFallbackIcon = pixbuf ? null : (fallbackIcon ?? null);
      this.preparedArtwork = null;
      this.syncLoadedArtwork();
    } catch (error) {
      if (
        !isCancellationError(error) &&
        this.isCurrentArtworkLoad(loadGeneration, loadCancellable, request)
      ) {
        logger.warnOnce(
          `artwork:${request.busName}`,
          "Enhance notification banner artwork could not be processed; using the fallback icon",
          error,
        );
        this.loadedArtworkKey = request.key;
        this.loadedArtworkPixbuf = null;
        this.loadedFallbackIcon = null;
        this.preparedArtwork = null;
        this.syncLoadedArtwork();
      }
    } finally {
      if (this.isCurrentArtworkLoad(loadGeneration, loadCancellable, request)) {
        this.loadingArtworkKey = null;
        this.artworkLoadCancellable = null;
      }
    }
  }

  syncLoadedArtwork() {
    if (!this.artworkFrame || !this.loadedArtworkKey) return;

    if (this.loadedArtworkPixbuf)
      this.setArtworkPixbuf(this.loadedArtworkPixbuf);
    else this.setArtworkFallback(this.loadedFallbackIcon);
  }

  setArtworkPixbuf(pixbuf) {
    const { imageSize, imageRadius } = getArtworkPresentationGeometry(
      ENHANCE_ARTWORK_SIZE,
      ENHANCE_ARTWORK_RADIUS,
    );
    if (
      this.preparedArtwork?.key !== this.loadedArtworkKey ||
      this.preparedArtwork.imageSize !== imageSize ||
      this.preparedArtwork.imageRadius !== imageRadius
    ) {
      this.preparedArtwork = {
        key: this.loadedArtworkKey,
        imageSize,
        imageRadius,
        pixbuf: prepareArtworkPixbuf(pixbuf, imageSize, imageRadius),
      };
    }

    this.artworkFallbackActive = false;
    this.syncArtworkGeometry();
    this.artworkImage.content = null;
    setGIcon(this.artworkImage, this.preparedArtwork.pixbuf, IconNames.MEDIA);
    this.artworkImage.set_icon_size(imageSize);
    this.artworkFrame.opacity = ACTIVE_OPACITY;
  }

  setArtworkFallback(icon) {
    if (!this.artworkFrame || !this.artworkImage) return;
    const { imageSize, fallbackIconSize } = getArtworkPresentationGeometry(
      ENHANCE_ARTWORK_SIZE,
      ENHANCE_ARTWORK_RADIUS,
    );
    this.artworkFallbackActive = true;
    this.syncArtworkGeometry();
    this.artworkImage.content = null;
    setGIcon(
      this.artworkImage,
      icon ?? this.fallbackArtworkIcon,
      IconNames.MEDIA,
    );
    this.artworkImage.set_icon_size(fallbackIconSize);
    this.artworkImage.set_size(imageSize, imageSize);
    this.artworkFrame.opacity = ACTIVE_OPACITY;
  }

  isCurrentArtworkLoad(loadGeneration, loadCancellable, request) {
    return (
      this.active &&
      this.banner.mapped &&
      loadGeneration === this.artworkLoadGeneration &&
      !loadCancellable.is_cancelled() &&
      this.loadingArtworkKey === request.key &&
      this.player?.busName === request.busName
    );
  }

  cancelArtworkLoad() {
    if (!this.artworkLoadCancellable) return;
    this.artworkLoadGeneration++;
    this.artworkLoadCancellable.cancel();
    this.artworkLoadCancellable = null;
    this.loadingArtworkKey = null;
  }

  handleNativeBannerDestroyed() {
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

  disconnectBannerSignals() {
    for (const [object, signalId] of this.bannerSignalIds.splice(0))
      object.disconnect(signalId);
  }

  disconnectPlayerState() {
    for (const { property, listenerId } of this.playerPropertyListeners)
      this.player.removePropertyChangeListener(property, listenerId);
    this.playerPropertyListeners = [];
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
      this.context.nativeControls.visible =
        this.nativeControlsWereVisible;
      if (Number.isFinite(this.nativeExpandButtonOpacity))
        this.context.setExpandButtonOpacity(this.nativeExpandButtonOpacity);
      this.context.refreshExpandButton();
    } catch (error) {
      logger.debugOnce(
        `restore:${this.player?.busName ?? "unknown"}`,
        "Native notification banner presentation could not be fully restored",
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
    this.cancelArtworkLoad();
    this.pauseProgressTransition();
    this.disconnectPlayerState();
    this.disconnectNativePresentationSignals();
    this.disconnectBannerSignals();

    if (restoreNative) this.restoreNativePresentation();

    for (const buttonState of this.controlButtons.values())
      buttonState.button.disconnect(buttonState.signalId);
    this.controlButtons.clear();

    if (this.playbackTransition) this.playbackTransition.stop();
    if (this.slider) this.slider.remove_transition(PROGRESS_TRANSITION_NAME);

    for (const actor of [
      this.actionBox,
      this.transportBox,
      this.artworkFrame,
    ]) {
      if (!actor) continue;
      actor.get_parent()?.remove_child(actor);
      actor.destroy();
    }

    this.context = null;
    this.banner = null;
    this.player = null;
    this.artworkService = null;
    this.playbackController = null;
    this.onDestroyed = null;
    this.transportBox = null;
    this.previousButton = null;
    this.playPauseButton = null;
    this.nextButton = null;
    this.actionBox = null;
    this.slider = null;
    this.playbackTransition = null;
    this.artworkFrame = null;
    this.artworkImage = null;
    this.artworkFallbackActive = false;
    this.loadedArtworkPixbuf = null;
    this.loadedFallbackIcon = null;
    this.preparedArtwork = null;
    this.fallbackArtworkIcon = null;
  }
}
