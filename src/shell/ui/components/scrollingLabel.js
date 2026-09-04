/**
 * @file scrollingLabel.js
 * @module shell.ui.components.scrollingLabel
 *
 * Provides a Shell actor that scrolls overflowing text while preserving read position.
 *
 * TopBarTrackInformation and PopupTrackInformation use this actor for long track
 * metadata. The actor owns its Clutter transition, cycle pause, and mapping
 * lifecycle so callers only provide text and scrolling settings.
 */

import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Pango from "gi://Pango";
import GLib from "gi://GLib";
import St from "gi://St";

import { GTypeNames } from "../../../shared/gobject.js";
import { StyleClasses } from "../../constants/styleClasses.js";
import {
  connectReducedMotionChanged,
  disconnectReducedMotionChanged,
  prefersReducedMotion,
} from "../../utils/reducedMotion.js";

const SCROLL_CYCLE_GAP = "  ".repeat(5);
const SCROLL_CYCLE_COPIES = 3;

/**
 * Provides a Shell actor that scrolls overflowing text while preserving read position.
 */
class ScrollingLabel extends St.ScrollView {
  label;
  labelBox;

  isScrolling;
  isFixedWidth;
  labelWidth;
  sourceText;
  cycleWidth;
  scrollPauseMilliseconds;
  scrollTransition;
  scrollPixelsPerMillisecond;

  labelShowSignalId;
  mappedSignalId;
  animationMappedSignalId;
  lifecycleMappedSignalId;
  adjustmentChangedSignalId;
  scrollCompletedSignalId;
  reducedMotionSignalId;

  initializationSourceId;
  adjustmentInitializationSourceId;
  cyclePauseSourceId;

  constructor(params) {
    super({
      hscrollbarPolicy: St.PolicyType.NEVER,
      vscrollbarPolicy: St.PolicyType.NEVER,
      styleClass: StyleClasses.SCROLLING_LABEL,
    });
    const defaultParams = {
      isFixedWidth: true,
      scrollPauseMilliseconds: 0,
    };
    const {
      text,
      width,
      isFixedWidth,
      isScrolling,
      scrollSpeed,
      scrollPauseMilliseconds,
    } = {
      ...defaultParams,
      ...params,
    };
    this.sourceText = text;
    this.scrollPauseMilliseconds = scrollPauseMilliseconds;
    this.isScrolling = isScrolling;
    this.isFixedWidth = isFixedWidth;
    this.labelWidth = width;
    this.cycleWidth = 0;
    this.labelShowSignalId = null;
    this.adjustmentChangedSignalId = null;
    this.mappedSignalId = null;
    this.animationMappedSignalId = null;
    this.lifecycleMappedSignalId = this.connect(
      "notify::mapped",
      this.handleMappedLifecycleChange.bind(this),
    );
    // Reacts immediately to the user toggling the system's reduced-motion accessibility preference.
    this.reducedMotionSignalId = connectReducedMotionChanged(() =>
      this.handleReducedMotionChanged(),
    );
    this.scrollCompletedSignalId = null;
    this.initializationSourceId = null;
    this.cyclePauseSourceId = null;
    this.adjustmentInitializationSourceId = null;
    this.scrollPixelsPerMillisecond = Math.max((scrollSpeed ?? 4) / 100, 0.01);
    this.labelBox = new St.BoxLayout({
      xExpand: true,
      yExpand: true,
    });
    this.label = new St.Label({
      text,
      yAlign: Clutter.ActorAlign.CENTER,
      xAlign: Clutter.ActorAlign.START,
    });
    this.labelShowSignalId = this.label.connect(
      "show",
      this.handleVisibilityOrMappingChange.bind(this),
    );
    this.mappedSignalId = this.connect(
      "notify::mapped",
      this.handleVisibilityOrMappingChange.bind(this),
    );
    this.initializationSourceId = GLib.idle_add(
      GLib.PRIORITY_DEFAULT_IDLE,
      () => {
        this.initializationSourceId = null;
        this.handleVisibilityOrMappingChange();
        return GLib.SOURCE_REMOVE;
      },
    );
    this.labelBox.add_child(this.label);
    this.add_child(this.labelBox);
  }

  canAnimateNow() {
    return this.label !== null && this.is_mapped() && this.get_stage() !== null;
  }

  handleMappedLifecycleChange() {
    if (!this.scrollTransition) return;
    if (!this.canAnimateNow() || prefersReducedMotion()) {
      this.scrollTransition.pause();
      return;
    }
    if (this.cyclePauseSourceId === null) this.scrollTransition.start();
  }

  /** Re-evaluates layout and scrolling when the system preference changes. */
  handleReducedMotionChanged() {
    if (!this.label) return;
    this.updateLayoutAndScrolling();
  }

  initializeScrollAnimation() {
    const adjustment = this.get_hadjustment();
    const cycleText = `${this.sourceText}${SCROLL_CYCLE_GAP}`;

    this.disconnectAdjustmentChangedSignal(adjustment);
    this.label.clutterText.ellipsize = Pango.EllipsizeMode.NONE;
    this.label.text = cycleText;
    const [, naturalCycleWidth] = this.label.get_preferred_width(-1);
    this.cycleWidth = Math.max(1, naturalCycleWidth);
    this.label.text = cycleText.repeat(SCROLL_CYCLE_COPIES);

    this.adjustmentChangedSignalId = adjustment.connect(
      "changed",
      this.handleAdjustmentChanged.bind(this, adjustment),
    );
    this.clearAdjustmentInitializationSource();
    this.adjustmentInitializationSourceId = GLib.idle_add(
      GLib.PRIORITY_DEFAULT_IDLE,
      () => {
        this.adjustmentInitializationSourceId = null;
        if (this.adjustmentChangedSignalId !== null)
          this.handleAdjustmentChanged(adjustment);
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  handleAdjustmentChanged(adjustment) {
    const isContinuous = this.scrollPauseMilliseconds === 0;
    const finalOffset = this.cycleWidth * (isContinuous ? 2 : 1);
    const maximumOffset = Math.max(0, adjustment.upper - adjustment.pageSize);
    if (maximumOffset < finalOffset) return;

    if (!this.canAnimateNow()) {
      if (this.animationMappedSignalId === null) {
        this.animationMappedSignalId = this.connect("notify::mapped", () => {
          if (!this.canAnimateNow()) return;
          this.disconnect(this.animationMappedSignalId);
          this.animationMappedSignalId = null;
          this.createScrollAnimation(adjustment);
        });
      }
      return;
    }

    this.createScrollAnimation(adjustment);
  }

  clearInitializationSource() {
    if (this.initializationSourceId === null) return;
    GLib.Source.remove(this.initializationSourceId);
    this.initializationSourceId = null;
  }

  clearAdjustmentInitializationSource() {
    if (this.adjustmentInitializationSourceId === null) return;
    GLib.Source.remove(this.adjustmentInitializationSourceId);
    this.adjustmentInitializationSourceId = null;
  }

  clearCyclePauseSource() {
    if (this.cyclePauseSourceId === null) return;
    GLib.Source.remove(this.cyclePauseSourceId);
    this.cyclePauseSourceId = null;
  }

  disconnectAdjustmentChangedSignal(adjustment = this.get_hadjustment()) {
    if (this.adjustmentChangedSignalId === null || !adjustment) return;
    adjustment.disconnect(this.adjustmentChangedSignalId);
    this.adjustmentChangedSignalId = null;
  }

  removeScrollTransition(adjustment = this.get_hadjustment()) {
    if (!this.scrollTransition) return;
    if (this.scrollCompletedSignalId !== null) {
      this.scrollTransition.disconnect(this.scrollCompletedSignalId);
      this.scrollCompletedSignalId = null;
    }
    adjustment?.remove_transition("scroll");
    this.scrollTransition = null;
  }

  createScrollAnimation(adjustment) {
    if (prefersReducedMotion()) {
      this.removeScrollTransition(adjustment);
      return;
    }

    if (this.animationMappedSignalId !== null) {
      this.disconnect(this.animationMappedSignalId);
      this.animationMappedSignalId = null;
    }

    this.removeScrollTransition(adjustment);
    this.clearAdjustmentInitializationSource();
    this.clearCyclePauseSource();
    this.disconnectAdjustmentChangedSignal(adjustment);

    const isContinuous = this.scrollPauseMilliseconds === 0;
    // Continuous mode scrolls between equivalent internal copies so the
    // repeated transition never resets at an adjustment boundary.
    const initialOffset = isContinuous ? this.cycleWidth : 0;
    const finalOffset = initialOffset + this.cycleWidth;
    const durationMilliseconds = Math.max(
      1,
      Math.round(this.cycleWidth / this.scrollPixelsPerMillisecond),
    );
    adjustment.value = initialOffset;

    const initialValue = new GObject.Value();
    initialValue.init(GObject.TYPE_DOUBLE);
    initialValue.set_double(initialOffset);
    const finalValue = new GObject.Value();
    finalValue.init(GObject.TYPE_DOUBLE);
    finalValue.set_double(finalOffset);
    const pspec = adjustment.find_property("value");
    const interval = new Clutter.Interval({
      valueType: pspec.value_type,
      initial: initialValue,
      final: finalValue,
    });
    this.scrollTransition = new Clutter.PropertyTransition({
      propertyName: "value",
      progressMode: Clutter.AnimationMode.LINEAR,
      repeatCount: isContinuous ? -1 : 0,
      duration: durationMilliseconds,
      interval,
    });

    if (!isContinuous) {
      this.scrollCompletedSignalId = this.scrollTransition.connect(
        "completed",
        () => this.handleScrollCompleted(adjustment),
      );
    }

    adjustment.add_transition("scroll", this.scrollTransition);
    if (!this.canAnimateNow()) this.scrollTransition.pause();
  }

  handleScrollCompleted(adjustment) {
    if (!this.label || !this.scrollTransition) return;

    this.scrollTransition.rewind();
    adjustment.value = 0;
    this.clearCyclePauseSource();
    this.cyclePauseSourceId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      this.scrollPauseMilliseconds,
      () => {
        this.cyclePauseSourceId = null;
        if (this.canAnimateNow() && this.scrollTransition)
          this.scrollTransition.start();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  handleVisibilityOrMappingChange() {
    if (this.label.visible === false) return;
    if (!this.canAnimateNow()) return;

    this.updateLayoutAndScrolling();
    if (this.labelShowSignalId !== null) {
      this.label.disconnect(this.labelShowSignalId);
      this.labelShowSignalId = null;
    }
    if (this.mappedSignalId !== null) {
      this.disconnect(this.mappedSignalId);
      this.mappedSignalId = null;
    }
  }

  updateLayoutAndScrolling() {
    const [, naturalWidth] = this.label.get_preferred_width(-1);
    const measuredWidth = Math.max(this.label.width, naturalWidth);
    const availableWidth =
      this.labelWidth > 0 ? this.labelWidth : Math.max(0, this.width);
    const isLabelWider = measuredWidth > availableWidth && availableWidth > 0;

    if (prefersReducedMotion()) {
      this.removeScrollTransition();
      this.label.clutterText.ellipsize = Pango.EllipsizeMode.END;
      return;
    }

    if (isLabelWider && this.isScrolling) this.initializeScrollAnimation();
    if (this.isFixedWidth && this.labelWidth > 0) {
      this.labelBox.width = this.labelWidth;
      this.label.xAlign = Clutter.ActorAlign.CENTER;
      this.label.xExpand = true;
    } else if (isLabelWider) {
      this.labelBox.width = availableWidth;
    }
  }

  vfunc_scroll_event() {
    return Clutter.EVENT_PROPAGATE;
  }

  destroy() {
    const label = this.label;
    if (!label) return;

    this.removeScrollTransition();
    this.disconnectAdjustmentChangedSignal();

    if (this.labelShowSignalId !== null) {
      label.disconnect(this.labelShowSignalId);
      this.labelShowSignalId = null;
    }
    if (this.mappedSignalId !== null) {
      this.disconnect(this.mappedSignalId);
      this.mappedSignalId = null;
    }
    if (this.animationMappedSignalId !== null) {
      this.disconnect(this.animationMappedSignalId);
      this.animationMappedSignalId = null;
    }
    if (this.lifecycleMappedSignalId !== null) {
      this.disconnect(this.lifecycleMappedSignalId);
      this.lifecycleMappedSignalId = null;
    }
    disconnectReducedMotionChanged(this.reducedMotionSignalId);
    this.reducedMotionSignalId = null;

    this.clearInitializationSource();
    this.clearAdjustmentInitializationSource();
    this.clearCyclePauseSource();
    this.label = null;
    this.labelBox = null;

    super.destroy();
  }
}

const RegisteredScrollingLabel = GObject.registerClass(
  {
    GTypeName: GTypeNames.SCROLLING_LABEL,
  },
  ScrollingLabel,
);

export default RegisteredScrollingLabel;
