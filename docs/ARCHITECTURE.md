# Architecture

MediaShell is organized by process boundary and UI ownership. Shell code owns GNOME Shell actors and MPRIS integration, Preferences code owns the GTK4/Libadwaita interface, and shared code contains toolkit-independent contracts and helpers.

The installable archive contains runtime files only. Documentation, tests, screenshots, source catalogs, and development tooling stay outside the extension package.

## Repository layers

```text
src/
  extension.js                 GNOME Shell entry point
  prefs.js                     Preferences entry point
  metadata.json                Extension manifest
  stylesheet.css               Shell styles
  shared/                      Toolkit-independent constants, enums, and helpers
  shell/                       GNOME Shell runtime
  prefs/                       GTK4/Libadwaita preferences runtime
assets/                        UI templates, schema, D-Bus XML, translations, and images
scripts/                       Validation, packaging, and development utilities
tests/                         Node tests for pure logic and parsed contracts
```

`src/shared/` does not import GNOME Shell or GTK. Shell and Preferences share its pure contracts, the compiled resource bundle, and GSettings values without importing each other.

## Runtime ownership

- `ExtensionController` owns enable/disable ordering, settings, services, the MPRIS registry, and top bar mounting.
- `MediaAppRegistry` owns D-Bus discovery and active-media-app selection.
- `PlayerProxy` represents one MPRIS endpoint and owns MPRIS method calls, property writes, cached properties, capabilities, and signals.
- `PositionTracker` projects playback position from exact reads, signals, rate, track identity, and monotonic time.
- `MediaAppResolver` maps MPRIS identity to installed applications and browser/PWA desktop entries.
- `TopBarButton` owns the panel button and popup; components under `ui/topBar/` and `ui/popup/` own their respective actors and teardown.
- `PreferencesController` owns GtkBuilder, bindings, page controllers, custom widgets, and Preferences teardown.

## Lifecycle

```text
extension.js
  -> ExtensionController.enable()
  -> initialize resources, settings, services, and shortcuts
  -> create the MPRIS registry
  -> select the active media app
  -> mount and update the top bar and popup

ExtensionController.destroy()
  -> destroy UI and listeners
  -> destroy registry, services, settings, and resources
  -> invalidate pending asynchronous work
```

`lifecycleGeneration` prevents callbacks from an older enable/destroy cycle from mutating current state. Components that create signals, GLib sources, cancellables, overrides, or asynchronous generations also own their cleanup.

## MPRIS model and selection

`MediaAppRegistry` watches `org.mpris.MediaPlayer2.*` names. D-Bus ownership defines endpoint lifetime; desktop and browser identity improve presentation, blocked-app matching, and app actions without replacing that authority.

Selection is deterministic: pinned, playing, previous active, paused, then the first valid endpoint. Pinning is runtime-only. Owner and metadata grace preserve useful state during short hand-offs, while browser/PWA resolution falls back safely when identity evidence is incomplete.

Playback controls follow one command path:

```text
control definition and surface policy
  -> pure state and accessibility decisions
  -> popup or top bar renderer
  -> executePlaybackControlAction()
  -> PlayerProxy
  -> MPRIS
```

Popup and top bar render separate actors but share the same decisions and executor. Seek buttons use relative `Seek(x)` with a fixed ten-second offset; the progress bar uses `SetPosition(ox)`. Playback speed is popup-only and reflects the rate confirmed by the endpoint.

## UI surfaces and updates

- **Panel** settings control where MediaShell is inserted.
- **Top bar** contains the app icon, track information, playback controls, and optional visualizer.
- **Popup** contains the app selector, album art, track information, progress bar, playback controls, and playback speed.

`TopBarButton.requestWidgetUpdate()` coalesces bursts of property changes and forwards the relevant `WidgetFlags` to `PopupContent.updateWidgets()`. While the popup is closed, affected regions are recorded and applied when it opens.

Top bar Width applies only to track information: `0` uses the available allocation, a positive value sets the maximum metadata width, and Lock width keeps that width for short text. Icons, the visualizer, and controls retain their natural width regardless of element order.

## Metadata and album art

`PlayerProxy` normalizes MPRIS metadata into display-safe values. Track identity prefers `mpris:trackid` and uses a conservative fallback for sparse endpoints.

`PopupAlbumArt` owns visible state and request generations. `AlbumArtLoader` owns local, cache, and network I/O, decoding, orientation, cropping, cancellation, and persistent storage. Late results are rejected through generation and active-endpoint checks.

Compressed input is limited to 16 MiB per image. The optional cache is limited to 128 MiB in total, has no file-count ceiling, and evicts the oldest entries first.

## Preferences

`prefs.js` initializes translations and resources before creating `PreferencesController`. Direct settings use bindings; controllers handle compound behavior such as shortcut capture, element ordering, sensitivity, cache actions, and track-information selection.

## Stable contracts

Compatibility-sensitive contracts include extension identity, supported GNOME versions, GSettings keys and enum values, MPRIS/D-Bus members, resource paths, GtkBuilder IDs/classes, CSS classes, `GTypeName` strings, persisted input-action values, playback-control IDs, and the package inventory.

Shared pure contracts live under `src/shared/constants/` or `src/shared/enums/`. Process-specific policy stays with its process, while runtime objects and local implementation details remain beside their owner.

## Private GNOME Shell API

`GnomeShellMediaControlsPatch` isolates the optional modification of GNOME's native media controls. Other unavoidable private Shell access stays local, capability-checked, reversible, documented beside the code, and tested on supported GNOME releases.
