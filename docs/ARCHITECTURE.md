# Architecture

MediaShell is organized around process boundaries and UI surfaces. Shell code owns actors, MPRIS, and GNOME Shell integration. Preferences code owns GTK4/Libadwaita UI. Shared code owns toolkit-independent constants, enums, settings helpers, and pure helpers.

The installable package contains only runtime files. Repository docs, tests, screenshots, source catalogs, and development-only assets stay outside the extension archive.

## Layers

```text
src/
  extension.js                 Shell entry point
  prefs.js                     Preferences entry point
  stylesheet.css               Shell stylesheet
  metadata.json                Extension manifest
  shared/                      Toolkit-independent constants, enums, settings helpers
  shell/                       GNOME Shell runtime code
  prefs/                       GTK4/Libadwaita preferences code
assets/                        GtkBuilder UI, schemas, D-Bus XML, translations, images
scripts/                       Validation, packaging, development helpers
tests/                         Node tests for pure logic and policies
```

### `src/shared/`

`shared` must remain independent from GNOME runtime APIs. It contains constants, enums, formatting, track information normalization, MPRIS helpers, logging, app identity, browser/PWA identity scoring, search, playback-control decisions, and visualizer math.

Use this layer for pure logic that can be tested with Node and reused by Shell and Preferences code without importing St, Clutter, Shell, Meta, GTK, Adw, or Gdk.

### `src/shell/`

`shell` runs inside GNOME Shell. It may use St, Clutter, Shell, Meta, Gio, GLib, and Shell UI resources.

Important owners:

- `ExtensionController`: enable/disable lifecycle, settings, services, MPRIS registry, and top bar mounting.
- `mpris/`: D-Bus discovery, `PlayerProxy`, position tracking, proxy creation, and active media-app selection.
- `services/`: album art, app resolution, global shortcuts, resources, and isolated GNOME Shell patches.
- `settings/`: runtime settings specification and store.
- `ui/topBar/`: compact top bar button, app icon, track information, playback controls, pointer actions, and visualizer.
- `ui/popup/`: popup container, app selector, album art, track information, progress bar, and playback controls.
- `utils/`: Shell-only helpers such as icon creation, pointer actions, and cancellation classification.

### `src/prefs/`

`prefs` runs in the preferences process. It may use GTK4, Libadwaita, Gio, GLib, and GObject, but must not import Shell-only APIs.

Important owners:

- `PreferencesController`: preferences lifecycle, builder, bindings, page controllers, and teardown.
- `bindings/`: standard widget-to-GSettings bindings.
- `groups/`: page-level controllers for compound preferences.
- `widgets/`: custom GTK/Libadwaita widgets registered with `MediaShell`-prefixed `GTypeName` values.
- `utils/`: preferences-only catalog, shortcut validation, cache service, and signal ownership helpers.

## Surfaces

MediaShell has separate configuration surfaces:

- **Panel** controls where the extension appears in the GNOME Shell panel/top bar area: position, index, and element order.
- **Top bar** controls the compact top bar button: app icon, track information, playback controls, and visualizer.
- **Popup** controls the menu opened by the top bar button: app selector, album art, track information, progress bar, and playback controls.
- **Interactions** controls mouse actions and keyboard shortcuts.
- **Others** contains blocked apps, cache maintenance, reset actions, and the Hide GNOME Shell media controls option.

Do not use Panel, Top bar, and Popup interchangeably. Panel is placement. Top bar is the visible button. Popup is the menu opened from that button.

## Runtime lifecycle

```text
[disabled]
    │ enable()
    ▼
[register resources]
    │ read settings
    ▼
[start services]
    │ shortcuts + Shell patches
    ▼
[initialize MPRIS]
    │ proxy factory + media app registry
    ▼
[active]
    │ active media app appears
    ▼
[mount top bar button]
    │ settings and MPRIS updates drive focused widget updates
    ▼
[disable]
    │ destroy in reverse dependency order
    ▼
[disabled]
```

`ExtensionController.lifecycleGeneration` guards asynchronous work. Each enable or destroy increments the generation; callbacks completed for a stale generation must discard their result instead of mutating current state.

## MPRIS lifecycle and selection

`MediaAppRegistry` watches names under `org.mpris.MediaPlayer2.*`. D-Bus name ownership is the lifecycle authority. Desktop identity improves display names, icons, blocked-app checks, and browser/PWA resolution, but presentation heuristics must not keep a vanished endpoint alive.

Browser/PWA identity is evidence-based. MediaShell may use desktop IDs, `StartupWMClass`, command lines, and MPRIS/runtime hints to recognize a web app launcher, but it must fall back to the normal media-app identity path when those fields are missing or contradictory. This keeps browser handling useful without turning package-specific quirks into lifecycle authority.

`PlayerProxy` normalizes one MPRIS endpoint into stable state, commands, metadata, capabilities, and property notifications. `PositionTracker` estimates position from explicit reads, `Seeked`, and monotonic time so the UI does not poll D-Bus every frame.

Active selection priority is: pinned media app, playing media app, current media app, paused media app, then first valid media app. Pinning is runtime-only.

## Widget updates

MPRIS endpoints often emit related property changes in bursts. `TopBarButton.requestWidgetUpdate()` and `PopupContent.requestWidgetUpdate()` collect `WidgetFlags` and reconcile affected regions together. Individual flags represent renderable regions; compound flags exist only for bulk resets.

Top bar and popup share pure decisions where useful, not actors. Track information shares metadata normalization. Playback controls share play/pause/stop resolution. Rendering, layout, and lifecycle remain surface-specific.

## Settings and contracts

The GSettings schema is the public contract for keys, defaults, enum IDs, and value ranges. `SettingsSpec` maps raw schema values into runtime values only when Shell code consumes them. Add a migration layer only for shipped schema upgrades that need one, and keep migrations idempotent and explicit.

Stable contracts include GSettings key names, schema enum IDs, D-Bus names, GTypeName strings, and CSS classes. Do not reuse them for new semantics.

Module headers document local ownership. Use them to identify what a file owns before changing its imports, lifecycle, or public contracts. Broader cross-module flow belongs in this document; local maintenance context belongs beside the code.

## Private Shell API boundary

`GnomeShellMediaControlsPatch` is the only intentional private GNOME Shell patch. It must remain isolated, capability-checked, reversible, and fail-open. Other code should integrate through public Shell, Gio, GLib, St, Clutter, settings, or MPRIS APIs.
