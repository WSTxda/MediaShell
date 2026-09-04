/**
 * @file nativeMediaControls.js
 * @module shell.integrations.nativeMediaControls
 *
 * Public MediaShell boundary for optional integration with GNOME Shell's
 * native media surfaces. Private Shell APIs remain behind the injected adapter.
 */

import GnomeShellMediaControlsAdapter from "../private/gnomeShell/mediaControls/adapter.js";

/** Exposes native-media integration without leaking private Shell contracts. */
export default class NativeMediaControlsIntegration {
  static supportsLockScreen() {
    return GnomeShellMediaControlsAdapter.supportsLockScreen();
  }

  constructor() {
    this.adapter = new GnomeShellMediaControlsAdapter();
  }

  reconcile({ profile, mode, mediaRuntime }) {
    this.adapter?.reconcile({ profile, mode, mediaRuntime });
  }

  reset() {
    this.adapter?.reset();
  }

  destroy() {
    const adapter = this.adapter;
    this.adapter = null;
    adapter?.destroy();
  }
}
