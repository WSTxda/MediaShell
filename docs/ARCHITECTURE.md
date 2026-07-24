# Architecture

MediaShell is split by process boundary and UI ownership. Shell code owns GNOME Shell actors and MPRIS integration. Preferences code owns GTK4/Libadwaita UI. Shared code contains pure contracts and helpers that can run without either toolkit.

The installable archive contains runtime files only. Documentation, tests, screenshots, source catalogs, and development tooling remain outside the extension package.

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
assets/                        UI templates, schema, D-Bus XML, translations, images
scripts/                       Validation, packaging, and GNOME development tools
tests/                         Node tests for pure logic and contracts
```

### Shared

`src/shared/` must not import GNOME Shell or Preferences toolkit modules. It owns settings vocabulary, D-Bus/MPRIS constants, resource and GType names, domain enums, metadata normalization, identity helpers, formatting, logging, collection utilities, search, playback decisions, and visualizer math.

### Shell

`src/shell/` runs inside GNOME Shell.

- `ExtensionController` owns enable/disable ordering, settings, services, the MPRIS registry, and top-bar mounting.
- `mpris/` owns D-Bus discovery, proxy creation, one `PlayerProxy` per endpoint, position tracking, and active-media-app selection.
- `services/` owns album-art loading, app resolution, global shortcuts, resources, and the isolated native-media-controls patch.
- `settings/` maps GSettings values into runtime state.
- `ui/topBar/` and `ui/popup/` own separate actors and lifecycle for their surfaces.

### Preferences

`src/prefs/` runs in the GTK preferences process.

- `PreferencesController` owns the builder, pages, bindings, controllers, widgets, and teardown.
- `bindings/` maps normal widgets to GSettings.
- `controllers/` coordinates behavior that spans multiple widgets or settings.
- `services/` owns preferences-side filesystem and installed-app access.
- `widgets/` contains custom GTK/Libadwaita widgets registered before GtkBuilder loads their templates.
- `resources/preferencesResourceLoader.js` registers the compiled resource once for the lifetime of the preferences process.

Shell and Preferences communicate only through shared contracts, the compiled resource bundle, and persisted GSettings values.

## Runtime lifecycle

```text
extension.js
  -> ExtensionController.enable()
  -> register resources and read settings
  -> start shortcuts and optional Shell patch
  -> initialize MPRIS proxy factory and registry
  -> select the active media app
  -> mount/update TopBarButton and PopupContent

ExtensionController.destroy()
  -> destroy UI and listeners
  -> destroy registry, services, settings, and resources
  -> invalidate pending asynchronous work
```

`lifecycleGeneration` prevents callbacks from an older enable/destroy cycle from mutating current state. Components that own GLib sources, signals, cancellables, or asynchronous generations must tear them down explicitly.

## MPRIS model

`MediaAppRegistry` watches `org.mpris.MediaPlayer2.*` names. D-Bus ownership is the endpoint lifecycle authority; desktop identity only improves names, icons, blocked-app matching, and focus/quit targets.

Each endpoint is represented by `PlayerProxy`, which normalizes properties, metadata, capabilities, commands, and property notifications. `PositionTracker` combines explicit position reads, `Seeked`, and monotonic time so UI updates do not poll D-Bus every frame.

The active-media-app policy is pure and deterministic:

1. pinned media app;
2. playing media app;
3. previous active media app;
4. paused media app;
5. first valid media app.

Pinning is runtime-only. Browser/PWA resolution is evidence-based and must fall back to normal media-app identity when installed-app metadata and runtime hints are absent or contradictory.

## UI surfaces and updates

- **Panel** settings control where MediaShell is inserted in the GNOME panel.
- **Top bar** is the compact button and its app icon, track information, playback controls, and visualizer.
- **Popup** is the opened menu and owns the app selector, album art, track information, progress bar, and playback controls.

`TopBarButton.requestWidgetUpdate()` combines bursts of property changes in one idle source. It updates top-bar components and forwards the combined `WidgetFlags` to `PopupContent.updateWidgets()`.

`PopupContent` renders immediately while open. While closed it records affected popup regions and applies them when the menu opens. The two surfaces may share pure state decisions, but never actors or toolkit lifecycle.

## Preferences flow

`prefs.js` initializes translations and the compiled resource, then creates `PreferencesController`. GtkBuilder constructs the pages and custom widgets; `PreferenceBinder` handles simple settings, while controllers own compound behavior such as shortcut capture, element ordering, sensitivity, cache actions, and track-information selection.

## Contracts and ownership

The public/declarative contracts are:

- `metadata.json` identity and supported Shell versions;
- GSettings keys, types, defaults, ranges, and enum IDs;
- D-Bus interfaces, methods, signals, properties, and MPRIS metadata field names;
- compiled resource paths and GtkBuilder IDs/classes;
- `GTypeName` strings;
- CSS class values;
- the final package inventory.

Shared contracts have one owner under `src/shared/constants/` or `src/shared/enums/`. Shell-only and Preferences-only layout/style values remain in their process-specific constants directories. Runtime objects and trivial local details stay with the component that creates them.

## Private GNOME Shell API

`GnomeShellMediaControlsPatch` is the only component that mutates GNOME's native media-controls implementation. It is capability-checked, reversible, isolated, and fail-open.

Small compatibility adapters may read private Shell fields when a supported release exposes no public equivalent—for example, `TopBarPointerHandler` disables `PanelMenu.Button._clickGesture` before installing its own GNOME 49+ gestures. Such access must remain local, capability-checked, documented beside the code, and restored during teardown.
