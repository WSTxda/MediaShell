# Architecture

MediaShell separates GNOME Shell runtime code, Preferences code, toolkit-independent shared logic, and developer tooling. Source boundaries are enforced by `scripts/check.mjs`, while generated package contents are enforced by `scripts/check-package.mjs`.

## Directory map

- `src/extension.js`: GNOME Shell entry point
- `src/shell/`: Shell runtime, MPRIS services, settings, and UI
- `src/prefs.js`: Preferences entry point
- `src/prefs/`: GTK and Libadwaita Preferences implementation
- `src/shared/`: constants, enums, migrations, and pure utilities
- `assets/`: GtkBuilder UI, GSettings schema, D-Bus XML, translations, and repository/store images
- `scripts/`: validation, package inspection, and local GNOME development helpers
- `tests/`: Node.js tests for shared and policy logic

Runtime packaging must include only files required by GNOME Shell at install time. Screenshots, source translation catalogs, documentation, tests, and repository-only media must not be shipped in the `.shell-extension.zip`. The build pipeline validates this with `scripts/check-package.mjs` after `gnome-extensions pack` creates the archive.

## Compatibility baseline

The supported GNOME Shell versions are declared in `src/metadata.json` and `src/shared/constants/platform.js`. Review and validation treat those two files as the compatibility contract.

The project follows a sliding stable-window policy: when a new supported Shell version is added, the oldest unsupported compatibility branch should be removed with the same change. Prefer one code path that works across the supported window; use version branches only when they are isolated, documented by the owning component, and required by a real API difference.

## Process boundaries

### Shell runtime

`ExtensionController` is the root owner for settings, MPRIS discovery, active media app selection, the Top Bar button, Popup content, Keyboard Shortcuts, Album Art loading, and the optional System media controls patch.

Shell modules may use GJS, Gio, GLib, GObject, St, Clutter, Shell, Meta, and GNOME Shell UI modules. They must not import GTK or Libadwaita.

### Preferences

`PreferencesController` owns resources, GSettings bindings, custom preference widgets, Blocked Apps, Album Art Cache maintenance, and the About dialog.

Preferences modules may use GTK, Libadwaita, Gio, and GLib. They must not import private GNOME Shell UI modules.

### Shared logic

Shared modules contain data and pure logic that can run without a GNOME UI process. They must not import GJS GI modules or GNOME Shell resources.

## Ownership and teardown

Every component owns the signals, main-loop sources, cancellables, proxies, actors, and caches it creates. Cleanup must be idempotent and proceed in reverse dependency order.

Asynchronous callbacks must confirm that the owner is alive and that the result still belongs to the active request, media app, or track before mutating state or UI.

## MPRIS lifecycle

`MediaAppRegistry` watches D-Bus names under `org.mpris.MediaPlayer2.*`. `MprisProxyFactory` creates proxies from the bundled introspection XML, and `PlayerProxy` normalizes remote values into a stable state surface.

The D-Bus name owner is authoritative for lifecycle. Desktop metadata may improve app identity and icon resolution, but it must not keep a vanished MPRIS endpoint alive.

Short owner changes may be coalesced to prevent browser-backed media sessions from flickering. Explicit teardown, blocklist changes, and confirmed owner loss must still remove stale state deterministically.

## Selection and pinning

`MediaAppSelectionPolicy` selects among registered media apps. A pin affects selection only while the associated endpoint remains registered; it is not persisted as an application preference.

The Popup App selector displays active endpoints, changes the active selection, and exposes the runtime pin state. Application actions use the MPRIS `Raise` and `Quit` methods only when the endpoint advertises support.

## Settings

The GSettings schema is authoritative for keys and defaults. `SettingsSpec` maps Shell-facing keys to normalized controller state and focused update impacts. `PreferenceBindings` maps standard widgets, while custom controllers handle compound UI.

Migrations copy legacy user values only when the destination does not already have a user value. They must remain idempotent and preserve enum semantics.

## UI updates

Property changes should update the narrowest affected component. Rebuilding the complete Top Bar button is reserved for placement changes that cannot be reconciled in place.

Actor creation, signal ownership, pointer gestures, and animation sources belong to the component that renders them. Hidden or unmapped visual components must stop timers and avoid background work.

Top Bar pointer handling uses `Clutter.ClickGesture` when available and never uses removed `Clutter.ClickAction` or `Clutter.TapAction`. Older supported Shell versions use isolated event-signal fallbacks without reintroducing removed action classes.

## Review-sensitive integration

Preferences must not retain window-scoped controllers on the exported Preferences class. `PreferencesController` owns the window lifecycle, connects `close-request`, and releases binders, controllers, settings, builder, and window references during teardown.

The EGO package must not ship compiled schemas, screenshots, `.po`/`.pot` source catalogs, tests, documentation, repository-only assets, or store raster exports. Store screenshots and icon exports are managed separately from the installable extension package. Source checks protect the build configuration, and package checks inspect the final archive.

## Validation model

Validation is split by artifact boundary because a package cannot be inspected before it exists: `scripts/check.mjs` validates the maintained source tree, `scripts/check-package.mjs` validates the generated `.shell-extension.zip`, and `shexli` is an external, EGO-oriented lint step that also targets the generated package. Shared constants for these scripts live in `scripts/project.mjs`. See [Development and validation](DEVELOPMENT.md) for the exact commands.

## Private GNOME Shell integration

`SystemMediaControlsPatch` is the only intentional private Shell patch. It must remain isolated, capability-checked, reversible, and fail-open so GNOME's controls remain available if Shell internals change.
