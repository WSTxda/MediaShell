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

/** Presents natural completed track transitions as a native GNOME Shell OSD. */
export default class TrackChangeToastSurface {
  constructor({
    transitionTracker,
    desktopAppResolver,
    showOsd,
    enabled = false,
  } = {}) {
    if (!transitionTracker)
      throw new TypeError(
        "TrackChangeToastSurface requires TrackTransitionTracker",
      );
    if (!desktopAppResolver)
      throw new TypeError(
        "TrackChangeToastSurface requires DesktopAppResolver",
      );
    if (typeof showOsd !== "function")
      throw new TypeError("TrackChangeToastSurface requires showOsd");

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

    const track = transition.player.track ?? transition.track;
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
