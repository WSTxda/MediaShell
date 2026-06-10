# Architecture

MediaShell separates GNOME Shell runtime code, Preferences code, and toolkit-independent shared logic. The boundary is enforced by `scripts/check.mjs`.

## Directory map

- `src/extension.js`: GNOME Shell entry point
- `src/shell/`: Shell runtime, MPRIS services, settings, and UI
- `src/prefs.js`: Preferences entry point
- `src/prefs/`: GTK and Libadwaita Preferences implementation
- `src/shared/`: constants, enums, migrations, and pure utilities
- `assets/`: GtkBuilder UI, GSettings schema, D-Bus XML, translations, and images
- `tests/`: Node.js tests for shared and policy logic

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

Actor creation, signal ownership, and animation sources belong to the component that renders them. Hidden or unmapped visual components must stop timers and avoid background work.

## Private GNOME Shell integration

`SystemMediaControlsPatch` is the only intentional private Shell patch. It must remain isolated, capability-checked, reversible, and fail-open so GNOME's controls remain available if Shell internals change.
