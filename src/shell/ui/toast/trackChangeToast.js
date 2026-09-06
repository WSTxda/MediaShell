/**
 * @file trackChangeToast.js
 * @module shell.ui.toast.trackChangeToast
 *
 * Presents natural track-change feedback through the native Shell OSD.
 *
 * Track-transition classification and Metadata stabilization belong to the
 * reusable TrackTransitionTracker. This UI owner applies the feature setting,
 * filters MediaShell-commanded replacements, and builds the OSD payload from
 * the immutable Track snapshot carried by a completed transition.
 */

import Gio from "gi://Gio";

import { TrackTransitionReasons } from "../../media/playback/trackTransitionTracker.js";

function preferSymbolicAppIcon(appIcon) {
  const names = appIcon?.get_names?.();
  if (!names) {
    return (
      appIcon ??
      Gio.ThemedIcon.new_from_names([
        "application-x-executable-symbolic",
        "application-x-executable",
        "image-missing-symbolic",
      ])
    );
  }

  return Gio.ThemedIcon.new_from_names([
    ...names
      .filter((name) => !name.endsWith("-symbolic"))
      .map((name) => `${name}-symbolic`),
    ...names,
    "application-x-executable-symbolic",
    "application-x-executable",
    "image-missing-symbolic",
  ]);
}

/** Owns the optional natural track-change OSD for one user session. */
export default class TrackChangeToast {
  constructor({
    transitionTracker,
    desktopAppResolver,
    showOsd,
    enabled = false,
  } = {}) {
    if (!transitionTracker)
      throw new TypeError("TrackChangeToast requires TrackTransitionTracker");
    if (!desktopAppResolver)
      throw new TypeError("TrackChangeToast requires DesktopAppResolver");
    if (typeof showOsd !== "function")
      throw new TypeError("TrackChangeToast requires showOsd");

    this.transitionTracker = transitionTracker;
    this.desktopAppResolver = desktopAppResolver;
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

    this.show(transition);
  }

  show(transition) {
    const track = transition?.track;
    const title = typeof track?.title === "string" ? track.title.trim() : "";
    if (!title) return;

    const player = transition.player;
    const desktopApp = this.desktopAppResolver.resolveDesktopApp(
      player.identity,
      player.desktopEntry,
      player.busName,
    );

    const appIcon =
      desktopApp &&
      this.desktopAppResolver.hasResolvedDesktopAppIcon(desktopApp)
        ? this.desktopAppResolver.resolveDesktopAppIcon(desktopApp)
        : null;

    this.showOsd({
      gicon: preferSymbolicAppIcon(appIcon),
      label: title,
    });
  }

  destroy() {
    this.unsubscribeTransition();
    this.unsubscribeTransition = null;
    this.transitionTracker = null;
    this.desktopAppResolver = null;
    this.showOsd = null;
  }
}
