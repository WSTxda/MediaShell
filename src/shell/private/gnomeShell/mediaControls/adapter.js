/**
 * @file adapter.js
 * @module shell.private.gnomeShell.mediaControls.adapter
 *
 * Selects and owns the private GNOME Shell media-controls implementation for
 * the active session profile. Hide and Enhance are independent user choices:
 * Hide owns the notification-list visibility policy, while Enhance can project
 * MediaShell presentation onto any supported native media surface.
 */

import { createLogger } from "../../../../shared/logging/logger.js";
import EnhancedMediaControls from "./enhance.js";
import HiddenMediaControls from "./hide.js";

const logger = createLogger("NativeMediaControlsAdapter");

const SessionProfiles = Object.freeze({
  USER: "user",
  UNLOCK_DIALOG: "unlock-dialog",
});

const Implementations = Object.freeze({
  HIDDEN_NOTIFICATION_LIST: "hidden-notification-list",
  ENHANCED_NOTIFICATION_LIST: "enhanced-notification-list",
  ENHANCED_LOCK_SCREEN: "enhanced-lock-screen",
});

function resolveImplementation(profile, hide, enhance, mediaRuntime) {
  if (profile === SessionProfiles.USER) {
    // Hiding the notification-list surface takes precedence there, but does not
    // disable lock-screen enhancement in another session profile.
    if (hide) return Implementations.HIDDEN_NOTIFICATION_LIST;
    if (enhance && mediaRuntime?.initialized)
      return Implementations.ENHANCED_NOTIFICATION_LIST;
    return null;
  }

  if (
    profile === SessionProfiles.UNLOCK_DIALOG &&
    enhance &&
    mediaRuntime?.initialized &&
    EnhancedMediaControls.supportsLockScreen()
  )
    return Implementations.ENHANCED_LOCK_SCREEN;

  return null;
}

/** Owns the active private GNOME Shell media-controls implementation. */
export default class GnomeShellMediaControlsAdapter {
  static supportsLockScreen() {
    return EnhancedMediaControls.supportsLockScreen();
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
        "Native media integration changed",
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
      case Implementations.HIDDEN_NOTIFICATION_LIST:
        return new HiddenMediaControls();
      case Implementations.ENHANCED_NOTIFICATION_LIST:
        return EnhancedMediaControls.createNotificationList(
          this.createEnhanceOptions(mediaRuntime),
        );
      case Implementations.ENHANCED_LOCK_SCREEN:
        return EnhancedMediaControls.createLockScreen(
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
