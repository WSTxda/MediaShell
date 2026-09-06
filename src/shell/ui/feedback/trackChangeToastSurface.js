/**
 * @file trackChangeToastSurface.js
 * @module shell.ui.feedback.trackChangeToastSurface
 *
 * Owns the optional track-change feedback surface for the user session.
 *
 * Transition detection belongs to TrackTransitionTracker and native OSD
 * compatibility belongs to the Shell OSD integration. This surface only decides
 * whether a natural completed transition should be presented.
 */

import { TrackTransitionReasons } from "../../media/playback/trackTransitionTracker.js";

/** Presents natural completed track transitions as a native GNOME Shell OSD. */
export default class TrackChangeToastSurface {
  constructor({ transitionTracker, showOsd, enabled = false } = {}) {
    if (!transitionTracker)
      throw new TypeError(
        "TrackChangeToastSurface requires TrackTransitionTracker",
      );
    if (typeof showOsd !== "function")
      throw new TypeError("TrackChangeToastSurface requires showOsd");

    this.transitionTracker = transitionTracker;
    this.showOsd = showOsd;
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
      transition.reason !== TrackTransitionReasons.COMPLETED ||
      transition.command
    )
      return;

    const track = transition.player.track ?? transition.track;
    const title = typeof track?.title === "string" ? track.title.trim() : "";
    if (!title) return;

    this.showOsd({
      iconName: "audio-x-generic-symbolic",
      label: title,
    });
  }

  destroy() {
    this.unsubscribeTransition();
    this.unsubscribeTransition = null;
    this.transitionTracker = null;
    this.showOsd = null;
  }
}
