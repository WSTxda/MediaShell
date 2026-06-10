# UI contract

This document defines the canonical names and ownership of MediaShell UI concepts.

## Canonical names

Use these names consistently in Preferences, README, documentation, comments that describe UI, and translations:

| Name | Meaning |
|---|---|
| Popup | The menu opened from the top bar button. |
| Top Bar | The GNOME Shell panel area containing the extension button. |
| Panel | Preferences for Top Bar placement and element order. |
| App selector | The Popup control used to select and pin an active media app. |
| App Icon | The active media app icon. |
| Track Information | Title, Artist, Album, and configured Top Bar content. |
| Playback Controls | Play / Pause, Next Track, Previous Track, Repeat, and Shuffle controls. |
| Playback Progress | Current position, duration, and seeking UI. |
| Volume Control | Volume slider and mute or restore action. |
| Album Art | Artwork displayed in the Popup. |
| Visualizer | Animated playback indicator in the Top Bar. |
| Mouse Actions | Actions assigned to pointer and touch gestures. |
| Keyboard Shortcuts | Global accelerators assigned to media actions. |
| Blocked Apps | Installed apps ignored by MediaShell. |
| System media controls | GNOME Shell's default media controls in the notification list. |

Use **media app** for a registered MPRIS endpoint represented by MediaShell. Use **player** only when referring to the MPRIS Player interface, `PlayerProxy`, or upstream protocol terminology.

## Preferences pages

The pages are Popup, Top Bar, Panel, Interactions, and Others. Titles and subtitles are defined in `assets/ui/prefs.ui` and focused custom UI files.

Feature switches must preserve stored child values when disabled. Child sensitivity follows the owning switch without resetting configuration.

## Top Bar

The top bar button may contain App Icon, Track Information, Visualizer, and Playback Controls in the persisted order. Hidden elements do not consume an order position.

Track Information supports configured fields, custom text, width, width locking, scrolling speed, and scrolling pause. Scrolling must stop when the actor is hidden or unmapped.

## Popup

The Popup presents the App selector first, then optional Album Art, Track Information, Playback Progress, Playback Controls, and Volume Control according to settings and media app capabilities.

The App selector uses the registry order, shows the active media app, exposes pin state, and dismisses correctly after selection or outside interaction.

## Icons and accessibility

Use symbolic GNOME icons unless a setting explicitly requests a full-color App Icon. Every icon-only control requires an accessible name or tooltip. Icon creation in the Shell process goes through `IconUtils` or the owning component helper.

## CSS

Selectors in `src/stylesheet.css` are component contracts. Rename a class only together with every producer and documentation reference. Prefer GNOME Shell style classes and inherited theme values over fixed colors or dimensions.
