/**
 * @file adapter.js
 * @module shell.private.gnome.nativecontrols.adapter
 *
 * Selects and owns the private GNOME Shell native controls implementation for
 * the active session profile. Hide and Enhance are independent user choices:
 * Hide owns notification center banner visibility, while Enhance can project
 * MediaShell presentation onto any supported native control surface.
 */

import { createLogger } from "../../../../shared/logging/logger.js";
import EnhanceNativeControls from "./enhance.js";
import HideNativeControls from "./hide.js";

const logger = createLogger("GnomeShellNativeControlsAdapter");

const SessionProfiles = Object.freeze({
  USER: "user",
  UNLOCK_DIALOG: "unlock-dialog",
});

const Implementations = Object.freeze({
  HIDE_NOTIFICATION_CENTER: "hide-notification-center",
  ENHANCE_NOTIFICATION_CENTER: "enhance-notification-center",
  ENHANCE_LOCK_SCREEN: "enhance-lock-screen",
});

function resolveImplementation(profile, hide, enhance, mediaRuntime) {
  if (profile === SessionProfiles.USER) {
    // Hide takes precedence in the notification center, but does not disable
    // lock-screen Enhance in another session profile.
    if (hide) return Implementations.HIDE_NOTIFICATION_CENTER;
    if (enhance && mediaRuntime?.initialized)
      return Implementations.ENHANCE_NOTIFICATION_CENTER;
    return null;
  }

  if (
    profile === SessionProfiles.UNLOCK_DIALOG &&
    enhance &&
    mediaRuntime?.initialized &&
    EnhanceNativeControls.supportsLockScreen()
  )
    return Implementations.ENHANCE_LOCK_SCREEN;

  return null;
}

/** Owns the active private GNOME Shell native controls implementation. */
export default class GnomeShellNativeControlsAdapter {
  static supportsLockScreenEnhance() {
    return EnhanceNativeControls.supportsLockScreen();
  }

  constructor() {
    this.implementation = null;
    this.implementationKind = null;
  }

  reconcile({ profile, hide, enhance, mediaRuntime }) {
    const implementationKind = resolveImplementation(
      profile,
      hide,
      enhance,
      mediaRuntime,
    );

    if (this.implementationKind !== implementationKind) {
      const previousKind = this.implementationKind;
      this.reset();
      this.implementationKind = implementationKind;
      logger.debug(
        "Native controls integration changed",
        previousKind ?? "default",
        "→",
        implementationKind ?? "default",
      );
      this.implementation = this.createImplementation(
        implementationKind,
        mediaRuntime,
      );
    }

    this.implementation?.reconcile();
  }

  createImplementation(implementationKind, mediaRuntime) {
    switch (implementationKind) {
      case Implementations.HIDE_NOTIFICATION_CENTER:
        return new HideNativeControls();
      case Implementations.ENHANCE_NOTIFICATION_CENTER:
        return EnhanceNativeControls.createNotificationCenter(
          this.createEnhanceOptions(mediaRuntime),
        );
      case Implementations.ENHANCE_LOCK_SCREEN:
        return EnhanceNativeControls.createLockScreen(
          this.createEnhanceOptions(mediaRuntime),
        );
      default:
        return null;
    }
  }

  createEnhanceOptions(mediaRuntime) {
    return {
      artworkService: mediaRuntime.artwork,
      playbackController: mediaRuntime.playback,
      getAvailablePlayers: () => mediaRuntime.getAvailablePlayers(),
    };
  }

  reset() {
    const implementation = this.implementation;
    this.implementation = null;
    this.implementationKind = null;
    implementation?.destroy();
  }

  destroy() {
    this.reset();
  }
}
