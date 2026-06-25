# Architecture

MediaShell is split into Shell runtime code, Preferences code, toolkit-independent shared logic, and development tooling. The installable extension package must contain only runtime files; docs, tests, screenshots, source catalogs, and repository-only assets stay outside the archive.

## Directory map

```text
src/
  extension.js                 Shell entry point
  prefs.js                     Preferences entry point
  stylesheet.css               Shell stylesheet
  metadata.json                Extension manifest
  shared/
    constants/                 D-Bus, settings, timing, limits, icons, playback descriptors
    enums/                     Domain enums by playback, top bar, widget, input, app, settings
    settings/                  GSettings migrations
    utils/                     Pure formatting, metadata, MPRIS, logging, search, identity helpers
  shell/
    constants/                 Shell-only UI measurements
    ExtensionController.js     Shell lifecycle root
    helpers/                   Shared Shell actors such as ScrollingLabel
    mpris/                     MPRIS discovery, proxies, position tracking, selection policy
    services/                  Shortcuts, resources, album art, app resolver, Shell patches
    settings/                  Runtime settings specification and store
    ui/                        Shell UI helpers, popup components, top bar components
    utils/                     Shell-only helpers such as Gio cancellation classification
  prefs/
    PreferencesController.js   Preferences window lifecycle root
    about/                     About dialog controller
    bindings/                  Standard widget-to-setting bindings
    groups/                    Page-level controllers
    resources/                 GtkBuilder and GResource loading
    utils/                     Preferences-only helpers
    widgets/                   Custom Libadwaita/GTK widgets
assets/                        UI templates, schemas, D-Bus XML, translations, repository images
scripts/                       Validation, packaging, development helpers
tests/                         Node tests for pure logic and policies
```

## Class inventory

### Shell layer

- `ExtensionController`: owns enable/disable, settings, Shell services, MPRIS registry, and top bar mounting.
- `GlobalShortcutsService`: registers and removes global media-action keybindings via `Main.wm`.
- `MprisProxyFactory`: creates typed D-Bus proxies from bundled introspection XML.
- `MediaAppRegistry`: discovers MPRIS bus names, owns `PlayerProxy` instances, filters blocked apps, and selects the active app.
- `PlayerProxy`: normalizes one MPRIS endpoint into stable state, commands, and property notifications.
- `PositionTracker`: estimates playback position from explicit reads, `Seeked`, and monotonic time.
- `MediaAppSelectionPolicy`: pure priority logic for active and next-app selection.
- `AlbumArtLoader`: singleton for local/remote album art and optional disk cache writes; `destroy()` aborts network work and cancels writes.
- `MediaAppResolver`: singleton for mapping MPRIS identity hints to Shell/Gio app objects; `clearCaches()` releases stale app references.
- `SystemMediaControlsPatch`: isolated, reversible patch for hiding GNOME's default media controls.
- `shell/utils/errors`: Shell-only cancellation classification shared by async services and MPRIS code.
- `TopBarButton`: top bar actor and popup owner.
- `TopBarPointerHandler`: pointer gesture and scroll wiring for non-playback top bar regions.
- `PopupContent`: popup container and coordinator for popup subcomponents.

### Preferences layer

- `PreferencesController`: owns the preferences window, builder, binders, page controllers, and teardown.
- `PreferenceBinder`: binds standard widgets declared in `PreferenceBindings` to GSettings.
- `PreferenceSensitivityController`: keeps dependent rows sensitive or insensitive based on settings.
- `TopBarStructureController`: coordinates top bar element ordering and track-information content widgets.
- `ShortcutsPageController`: drives the keyboard shortcut UI page.
- `OthersPageController`: owns blocked apps, reset actions, cache maintenance, and system-level rows.
- `AboutDialogController`: adds and displays the About dialog.
- `SignalConnections`: explicit signal ownership helper for preferences controllers.
- `BlockedAppsGroup`, `BlockedAppChooserDialog`, `TopBarElementOrderGroup`, `TopBarTrackInformationContentRow`: custom GTK/libadwaita widgets registered with `MediaShell`-prefixed `GTypeName` values.

### Shared layer

- `shared/constants/*`: canonical static values for settings bounds, D-Bus names, timing, limits, icons, input actions, and playback descriptors.
- `shared/enums/*`: domain enums grouped by feature area. Import specific domain files so runtime packages do not ship unreachable barrel modules.
- `SettingsMigration`: idempotent legacy-key migrations and schema-version handling.
- `shared/utils/*`: pure utility code with no GI or Shell imports.

## Extension lifecycle

```text
[disabled]
    │ enable()
    ▼
[register resources]
    │ read settings + migrate schema version
    ▼
[start services]
    │ GlobalShortcutsService + SystemMediaControlsPatch
    ▼
[initialize MPRIS]
    │ MprisProxyFactory.init() + MediaAppRegistry.init()
    ▼
[active]
    │ active media app appears
    ▼
[mount TopBarButton]
    │ settings/MPRIS updates drive focused widget updates
    ▼
[disable]
    │ destroy in reverse dependency order
    ▼
[disabled]
```

`ExtensionController.lifecycleGeneration` guards async work. Every enable or destroy increments the generation; callbacks that complete with a stale generation discard their result instead of mutating current state.

## Widget update flow

MPRIS endpoints often emit related property changes in bursts. `TopBarButton.requestWidgetUpdate()` ORs `WidgetFlags` into a pending field and schedules one `GLib.idle_add` callback. The idle callback renders the narrowest affected regions once after the current main-loop turn drains. `PopupContent` uses the same flag model. Individual bits map to renderable regions; compound flags such as `TOP_BAR`, `POPUP`, and `ALL` exist only for bulk resets.

## MPRIS lifecycle and selection

`MediaAppRegistry` watches names under `org.mpris.MediaPlayer2.*`. D-Bus name ownership is the lifecycle authority. Desktop identity improves presentation, icon resolution, and blocklist checks, but presentation heuristics do not keep a vanished endpoint alive.

Owner loss is hidden from the selector immediately and retained for a bounded hand-off window so browser-backed media sessions do not flicker between adjacent endpoints. Active selection priority is: pinned app, playing app, current app, paused app, then first valid app. Pinning is runtime-only.

## Settings

The GSettings schema is the public contract for keys, defaults, enum IDs, and value ranges. `SettingsSpec` maps runtime keys to controller properties, typed transforms, update impacts, and imperative actions. `PreferenceBindings` handles standard widgets; page controllers handle compound UI.

Migrations copy legacy user values only when the destination key has no explicit user value. They must be idempotent and preserve enum semantics.

## Process boundaries
Shell code may use St, Clutter, Shell, Meta, and GNOME Shell UI modules. Preferences code may use GTK and Libadwaita. Shared code has no GI or Shell imports.

Class names are PascalCase without a `MediaShell` prefix, except entry points. `GTypeName` strings always carry the `MediaShell` prefix. Constants are `SCREAMING_SNAKE_CASE`. Everything else follows the file name.

## Private GNOME Shell integration
`SystemMediaControlsPatch` is the only intentional private Shell patch. It must remain isolated, capability-checked, reversible, and fail-open so GNOME's controls remain available if Shell internals change.
