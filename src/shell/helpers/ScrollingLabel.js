// Provides a reusable clipped label with pause-aware horizontal scrolling.
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Pango from "gi://Pango";
import GLib from "gi://GLib";
import St from "gi://St";

class ScrollingLabel extends St.ScrollView {
    label;
    labelBox;
    adjustmentChangedSignalId;
    labelShowSignalId;

    isScrolling;
    isFixedWidth;
    isPaused;
    labelWidth;
    direction;
    scrollTransition;
    scrollSpeed;

    constructor(params) {
        super({
            hscrollbarPolicy: St.PolicyType.NEVER,
            vscrollbarPolicy: St.PolicyType.NEVER,
            styleClass: "mediashell-scrolling-label",
        });
        const defaultParams = {
            direction: Clutter.TimelineDirection.FORWARD,
            isFixedWidth: true,
            scrollPauseMilliseconds: 0,
        };
        const { text, width, direction, isFixedWidth, isScrolling, isPaused, scrollSpeed, scrollPauseMilliseconds } = {
            ...defaultParams,
            ...params,
        };
        this.destroyed = false;
        this.scrollPauseMilliseconds = scrollPauseMilliseconds;
        this.isScrolling = isScrolling;
        this.isFixedWidth = isFixedWidth;
        this.isPaused = isPaused;
        this.labelWidth = width;
        this.direction = direction;
        this.labelShowSignalId = null;
        this.adjustmentChangedSignalId = null;
        this.mappedSignalId = null;
        this.animationMappedSignalId = null;
        this.lifecycleMappedSignalId = this.connect("notify::mapped", this.handleMappedLifecycleChange.bind(this));
        this.scrollCompletedSignalId = null;
        this.initialPauseSourceId = null;
        this.cyclePauseSourceId = null;
        this.adjustmentInitializationSourceId = null;
        this.scrollSpeed = Math.max((scrollSpeed ?? 4) / 100, 0.01);
        this.labelBox = new St.BoxLayout({
            xExpand: true,
            yExpand: true,
        });
        this.label = new St.Label({
            text,
            yAlign: Clutter.ActorAlign.CENTER,
            xAlign: Clutter.ActorAlign.START,
        });
        this.labelShowSignalId = this.label.connect("show", this.handleVisibilityOrMappingChange.bind(this));
        this.mappedSignalId = this.connect("notify::mapped", this.handleVisibilityOrMappingChange.bind(this));
        this.initializationSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.initializationSourceId = null;
            this.handleVisibilityOrMappingChange();
            return GLib.SOURCE_REMOVE;
        });
        this.labelBox.add_child(this.label);
        this.add_child(this.labelBox);
    }

    canAnimateNow() {
        return !this.destroyed && !this.isPaused && this.is_mapped() && this.get_stage() != null;
    }

    handleMappedLifecycleChange() {
        if (!this.scrollTransition) return;
        if (!this.is_mapped() || this.get_stage() == null) {
            this.scrollTransition.pause();
            return;
        }
        if (this.canAnimateNow() && this.initialPauseSourceId == null && this.cyclePauseSourceId == null) {
            this.scrollTransition.start();
        }
    }

    pauseScrolling() {
        this.isPaused = true;
        this.scrollTransition?.pause();
    }

    resumeScrolling() {
        this.isPaused = false;
        if (!this.scrollTransition) return;
        if (
            this.canAnimateNow() &&
            this.initialPauseSourceId == null &&
            this.cyclePauseSourceId == null
        )
            this.scrollTransition.start();
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;

        // Stop and remove any active scroll transitions before destroying
        if (this.scrollTransition) {
            if (this.scrollCompletedSignalId != null) {
                this.scrollTransition.disconnect(this.scrollCompletedSignalId);
                this.scrollCompletedSignalId = null;
            }
            const adjustment = this.get_hadjustment();
            if (adjustment) {
                adjustment.remove_transition("scroll");
            }
            this.scrollTransition = null;
        }

        // Disconnect any pending signal handlers
        if (this.adjustmentChangedSignalId != null) {
            const adjustment = this.get_hadjustment();
            if (adjustment) {
                adjustment.disconnect(this.adjustmentChangedSignalId);
            }
            this.adjustmentChangedSignalId = null;
        }

        if (this.labelShowSignalId != null && this.label) {
            this.label.disconnect(this.labelShowSignalId);
            this.labelShowSignalId = null;
        }

        if (this.mappedSignalId != null) {
            this.disconnect(this.mappedSignalId);
            this.mappedSignalId = null;
        }
        if (this.animationMappedSignalId != null) {
            this.disconnect(this.animationMappedSignalId);
            this.animationMappedSignalId = null;
        }
        if (this.lifecycleMappedSignalId != null) {
            this.disconnect(this.lifecycleMappedSignalId);
            this.lifecycleMappedSignalId = null;
        }

        if (this.initializationSourceId != null) {
            GLib.Source.remove(this.initializationSourceId);
            this.initializationSourceId = null;
        }

        if (this.adjustmentInitializationSourceId != null) {
            GLib.Source.remove(this.adjustmentInitializationSourceId);
            this.adjustmentInitializationSourceId = null;
        }

        if (this.initialPauseSourceId != null) {
            GLib.Source.remove(this.initialPauseSourceId);
            this.initialPauseSourceId = null;
        }

        if (this.cyclePauseSourceId != null) {
            GLib.Source.remove(this.cyclePauseSourceId);
            this.cyclePauseSourceId = null;
        }

        super.destroy();
    }

    initializeScrollAnimation() {
        const adjustment = this.get_hadjustment();
        const originalText = this.label.text + "     ";

        // Clean up any existing handler first
        if (this.adjustmentChangedSignalId != null) {
            adjustment.disconnect(this.adjustmentChangedSignalId);
            this.adjustmentChangedSignalId = null;
        }

        this.adjustmentChangedSignalId = adjustment.connect(
            "changed",
            this.handleAdjustmentChanged.bind(this, adjustment, originalText),
        );
        this.label.text = `${originalText} `;
        this.label.clutterText.ellipsize = Pango.EllipsizeMode.NONE;
        this.adjustmentInitializationSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.adjustmentInitializationSourceId = null;
            if (this.adjustmentChangedSignalId != null) {
                this.handleAdjustmentChanged(adjustment, originalText);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    handleAdjustmentChanged(adjustment, originalText) {
        if (adjustment.upper <= adjustment.pageSize) {
            return;
        }

        if (!this.is_mapped() || this.get_stage() == null) {
            if (this.animationMappedSignalId == null) {
                this.animationMappedSignalId = this.connect("notify::mapped", () => {
                    if (!this.is_mapped() || this.get_stage() == null) return;
                    this.disconnect(this.animationMappedSignalId);
                    this.animationMappedSignalId = null;
                    this.createScrollAnimation(adjustment, originalText);
                });
            }
            return;
        }

        this.createScrollAnimation(adjustment, originalText);
    }

    createScrollAnimation(adjustment, originalText) {
        if (this.animationMappedSignalId != null) {
            this.disconnect(this.animationMappedSignalId);
            this.animationMappedSignalId = null;
        }

        // Remove any existing scroll transition first
        if (this.scrollTransition) {
            if (this.scrollCompletedSignalId != null) {
                this.scrollTransition.disconnect(this.scrollCompletedSignalId);
                this.scrollCompletedSignalId = null;
            }
            adjustment.remove_transition("scroll");
            this.scrollTransition = null;
        }
        if (this.adjustmentInitializationSourceId != null) {
            GLib.Source.remove(this.adjustmentInitializationSourceId);
            this.adjustmentInitializationSourceId = null;
        }

        if (this.initialPauseSourceId != null) {
            GLib.Source.remove(this.initialPauseSourceId);
            this.initialPauseSourceId = null;
        }
        if (this.cyclePauseSourceId != null) {
            GLib.Source.remove(this.cyclePauseSourceId);
            this.cyclePauseSourceId = null;
        }

        const initialValue = new GObject.Value();
        initialValue.init(GObject.TYPE_DOUBLE);
        initialValue.set_double(adjustment.value);
        const finalValue = new GObject.Value();
        finalValue.init(GObject.TYPE_DOUBLE);
        finalValue.set_double(Math.max(0, adjustment.upper - adjustment.pageSize));
        const distance = Math.max(1, adjustment.upper - adjustment.pageSize - adjustment.value);
        const durationMilliseconds = Math.max(1, Math.round(distance / this.scrollSpeed));
        const pspec = adjustment.find_property("value");
        const interval = new Clutter.Interval({
            valueType: pspec.value_type,
            initial: initialValue,
            final: finalValue,
        });
        this.scrollTransition = new Clutter.PropertyTransition({
            propertyName: "value",
            progressMode: Clutter.AnimationMode.LINEAR,
            direction: this.direction,
            repeatCount: 0,
            duration: durationMilliseconds,
            interval,
        });
        this.label.text = `${originalText} ${originalText}`;

        // Disconnect the adjustment changed handler if it's still connected
        if (this.adjustmentChangedSignalId != null) {
            adjustment.disconnect(this.adjustmentChangedSignalId);
            this.adjustmentChangedSignalId = null;
        }

        this.scrollCompletedSignalId = this.scrollTransition.connect("completed", () => {
            if (this.destroyed || !this.scrollTransition) return;
            this.scrollTransition.rewind(); // Snap back to 0

            if (this.scrollPauseMilliseconds > 0) {
                if (this.cyclePauseSourceId != null) {
                    GLib.Source.remove(this.cyclePauseSourceId);
                }
                this.cyclePauseSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.scrollPauseMilliseconds, () => {
                    this.cyclePauseSourceId = null;
                    if (this.canAnimateNow() && this.scrollTransition) this.scrollTransition.start();
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                if (this.canAnimateNow()) this.scrollTransition.start();
            }
        });

        if (this.scrollPauseMilliseconds > 0) {
            this.initialPauseSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.scrollPauseMilliseconds, () => {
                this.initialPauseSourceId = null;
                if (this.destroyed || !this.scrollTransition) return GLib.SOURCE_REMOVE;
                adjustment.add_transition("scroll", this.scrollTransition);
                if (!this.canAnimateNow()) this.scrollTransition.pause();
                return GLib.SOURCE_REMOVE;
            });
        } else {
            adjustment.add_transition("scroll", this.scrollTransition);
            if (!this.canAnimateNow()) {
                this.scrollTransition.pause();
            }
        }
    }

    handleVisibilityOrMappingChange() {
        if (this.label.visible === false) {
            return;
        }

        if (!this.is_mapped() || this.get_stage() == null) {
            return;
        }

        this.updateLayoutAndScrolling();
        if (this.labelShowSignalId != null) {
            this.label.disconnect(this.labelShowSignalId);
            this.labelShowSignalId = null;
        }
        if (this.mappedSignalId != null) {
            this.disconnect(this.mappedSignalId);
            this.mappedSignalId = null;
        }
    }

    updateLayoutAndScrolling() {
        const [, naturalWidth] = this.label.get_preferred_width(-1);
        const measuredWidth = Math.max(this.label.width, naturalWidth);
        const availableWidth = this.labelWidth > 0 ? this.labelWidth : Math.max(0, this.width);
        const isLabelWider = measuredWidth > availableWidth && availableWidth > 0;
        if (isLabelWider && this.isScrolling) {
            this.initializeScrollAnimation();
        }
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
}

const RegisteredScrollingLabel = GObject.registerClass(
    {
        GTypeName: "ScrollingLabel",
    },
    ScrollingLabel,
);

export default RegisteredScrollingLabel;
