/**
 * @file panelMenu.js
 * @module shell.integrations.panelMenu
 *
 * Public MediaShell boundary for the small private PanelMenu compatibility shim.
 *
 * Indicator code depends on this integration rather than GNOME Shell private
 * fields. Version-specific/private adaptation remains quarantined under
 * shell/private/gnomeShell/panelMenu.
 */

import { suspendDefaultPanelClickGesture } from "../private/gnomeShell/panelMenu/compatibility.js";

/** Temporarily disables PanelMenu's default primary activation when supported. */
export function suspendPanelMenuPrimaryActivation(panelButton) {
  return suspendDefaultPanelClickGesture(panelButton);
}
