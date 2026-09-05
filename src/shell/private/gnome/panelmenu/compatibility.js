/**
 * @file compatibility.js
 * @module shell.private.gnome.panelmenu.compatibility
 *
 * Contains the single private PanelMenu.Button compatibility hook MediaShell
 * needs for custom pointer routing.
 *
 * GNOME Shell 50+ owns primary PanelMenu activation through a private
 * `_clickGesture`. MediaShell disables that gesture while its own non-playback
 * action regions are installed, then restores the exact same gesture on teardown.
 * No caller outside the public integration boundary may access this field.
 */

/**
 * Suspends PanelMenu.Button's private primary-activation gesture when available.
 *
 * Returns an idempotent restore callback. Older Shell versions without the
 * gesture are a no-op and continue through MediaShell's public Clutter fallback.
 */
export function suspendDefaultPanelClickGesture(panelButton) {
  const clickGesture = panelButton?._clickGesture ?? null;
  if (!clickGesture || typeof clickGesture.set_enabled !== "function")
    return () => {};

  clickGesture.set_enabled(false);
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    if (typeof clickGesture.set_enabled === "function")
      clickGesture.set_enabled(true);
  };
}
