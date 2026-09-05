/**
 * @file nativeControls.js
 * @module shell.integrations.nativeControls
 *
 * Public MediaShell boundary for optional integration with GNOME Shell native
 * controls. Private Shell APIs remain behind the injected adapter.
 */

import GnomeShellNativeControlsAdapter from "../private/gnome/nativecontrols/adapter.js";

/** Exposes native controls integration without leaking private Shell contracts. */
export default class NativeControlsIntegration {
  static supportsLockScreenEnhance() {
    return GnomeShellNativeControlsAdapter.supportsLockScreenEnhance();
  }

  constructor() {
    this.adapter = new GnomeShellNativeControlsAdapter();
  }

  reconcile({ profile, hide, enhance, mediaRuntime }) {
    this.adapter?.reconcile({ profile, hide, enhance, mediaRuntime });
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
