/**
 * @file trackChangeToastSurface.js
 * @module shell.ui.feedback.trackChangeToastSurface
 *
 * Owns the optional track-change feedback surface for the user session.
 *
 * Transition detection belongs to TrackTransitionTracker and native OSD
 * compatibility belongs to OsdIntegration. This surface only decides whether a
 * completed transition should be presented and supplies canonical Track data.
 */

import { TrackTransitionReasons } from "../../media/playback/trackTransitionTracker.js";

/** Presents completed track transitions as a native GNOME Shell OSD. */
export default class TrackChangeToastSurface {
  constructor({ transitionTracker, osdIntegration, enabled = false } = {}) {
    if (!transitionTracker)
      throw new TypeError(
        "TrackChangeToastSurface requires TrackTransitionTracker",
      );
    if (!osdIntegration)
      throw new TypeError("TrackChangeToastSurface requires OsdIntegration");

    this.transitionTracker = transitionTracker;
    this.osdIntegration = osdIntegration;
    this.enabled = Boolean(enabled);
    this.unsubscribeTransition = transitionTracker.onTransition((transition) =>
      this.handleTransition(transition),
    );
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  handleTransition(transition) {
    if (
      !this.enabled ||
      transition?.reason !== TrackTransitionReasons.COMPLETED
    )
      return;

    const track = transition.player?.track ?? transition.track;
    const title = typeof track?.title === "string" ? track.title.trim() : "";
    if (!title) return;

    this.osdIntegration?.show({
      iconName: "audio-x-generic-symbolic",
      label: title,
    });
  }

  destroy() {
    this.unsubscribeTransition?.();
    this.unsubscribeTransition = null;
    this.transitionTracker = null;
    this.osdIntegration = null;
  }
}
