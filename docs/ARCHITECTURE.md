# Architecture

This document defines the runtime boundaries, ownership rules, and state flow implemented by MediaShell.

## Platform boundary

MediaShell supports GNOME Shell 47–50. Preferences require GTK 4 and Libadwaita 1.6 or later.

The authoritative declarations are `src/metadata.json`, `src/shared/constants/platform.js`, and the compatibility checks in `scripts/check.mjs`. Shell code must not depend on APIs introduced after the oldest supported Shell release.

## Processes

### Shell process

`src/extension.js` creates `ExtensionController`, which owns:

- settings and migrations;
- MPRIS discovery and proxies;
- active media app selection;
- the top bar button and Popup;
- Keyboard Shortcuts;
- Album Art loading;
- the optional System media controls patch.

Shell modules may use Gio, GLib, GObject, St, Clutter, Shell, Meta, and GNOME Shell UI modules. They must not import GTK or Libadwaita.

### Preferences process

`src/prefs.js` creates `PreferencesController`, which owns:

- GTK and Libadwaita resources;
- GSettings bindings;
- Top Bar structure controls;
- Keyboard Shortcuts configuration;
- Blocked Apps;
- Album Art Cache maintenance;
- the About dialog.

Preferences modules must not import private GNOME Shell UI modules.

### Shared modules

`src/shared/` contains toolkit-independent constants, enums, migrations, formatting, normalization, logging, search, MPRIS helpers, and Visualizer calculations. Shared modules remain importable by Node.js tests.

## Ownership and teardown

`ExtensionController` is the root runtime owner. Each component owns the signals, sources, cancellables, proxies, actors, and caches it creates. Cleanup must be idempotent and run in reverse dependency order.

Asynchronous callbacks must verify that their owner is still alive and that the result belongs to the current request, media app, or track before updating state or UI.

## MPRIS model

### Discovery

`MediaAppRegistry` watches names under `org.mpris.MediaPlayer2.*`. `MprisProxyFactory` builds proxies from the bundled D-Bus introspection XML. `PlayerProxy` normalizes remote values and publishes a stable media app state.

The D-Bus name owner is authoritative for lifecycle. `MediaAppResolver` may use identity, DesktopEntry, bus name, WM class, running apps, and Shell search for presentation, but heuristic resolution must not delete a valid MPRIS media app.

### Owner hand-off

When an owner disappears, the registry removes the endpoint from normal selection and starts a bounded hand-off period. A replacement owner for the same bus name reuses the existing `PlayerProxy`. Explicit removal and extension shutdown cancel pending recovery.

An exact MPRIS DesktopEntry match may shorten cleanup after the corresponding Shell app stops. Presentation-only matches cannot do so.

### App selection

`MediaAppSelectionPolicy` selects in this order:

1. pinned media app;
2. playing media app;
3. current valid media app;
4. paused media app;
5. first valid media app.

The **App selector** exposes the same registry order and pin state. Cycling is deterministic.

### State synchronization

`PlayerProxy` owns MPRIS property signals and commands. `PositionTracker` extrapolates Playback Progress from monotonic time only while playback is active, clamps to a valid duration, and resynchronizes from authoritative MPRIS updates.

Metadata normalization rejects invalid variants and the MPRIS `NoTrack` path. Empty browser metadata may remain temporarily valid while playback is active so transient updates do not remove the media app.

## Top Bar

`TopBarButton` coordinates the active media app and coalesces component updates. Its persisted element order contains:

- App Icon;
- Track Information;
- Visualizer;
- Playback Controls.

Components reuse actors where practical. A media app change updates the required components without rebuilding the element order.

`ScrollingLabel` owns its Clutter transition, pause sources, mapped-state signal, and adjustment. `TopBarVisualizer` uses a Clutter timeline and performs no continuous work while disabled, paused, unmapped, or destroyed.

## Popup

`PopupContent` coordinates:

- App selector;
- Album Art;
- Track Information;
- Playback Progress;
- Playback Controls;
- Volume Control.

The Popup defers expensive updates while closed. Optional sections create or destroy their own actors according to settings and disconnect obsolete state when removed.

## Album Art

`AlbumArtLoader` supports local files and bounded HTTP or HTTPS downloads. Requests are cancellable, size-limited, and optionally cached. `PopupAlbumArt` uses request generations so stale completions cannot replace artwork for a newer track or media app.

## Settings

The schema is `assets/org.gnome.shell.extensions.mediashell.gschema.xml`. Runtime mapping is declared in `src/shell/settings/SettingsSpec.js`; Preferences bindings are declared in `src/prefs/bindings/PreferenceBindings.js`; migrations are implemented in `src/shared/settings/SettingsMigration.js`.

A setting change is complete only when schema, runtime state, Preferences, migrations, translations, tests, and documentation agree.

## Resources and packaging

The GResource contains runtime UI and D-Bus XML. `pnpm build` validates the source, recreates `dist/`, copies runtime files, compiles resources, and packages the extension with its schema, translations, icons, and source modules.

Generated output is disposable and must not be committed.
