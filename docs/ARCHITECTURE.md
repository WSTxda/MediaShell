# Architecture

MediaShell is organized by process boundary and resource ownership. GNOME Shell owns runtime integration, MPRIS state, and Shell actors. Preferences runs separately with GTK4/Libadwaita. Shared modules contain toolkit-independent contracts and pure behavior used by either process.

This document describes durable boundaries, owners, and flows. Implementation conventions and validation mechanics belong in [Development](DEVELOPMENT.md); contributor obligations belong in [Contributing](../CONTRIBUTING.md).

## Repository and process boundaries

| Path                    | Responsibility                                                          |
| ----------------------- | ----------------------------------------------------------------------- |
| `src/extension.js`      | GNOME Shell entrypoint.                                                 |
| `src/prefs.js`          | Preferences entrypoint.                                                 |
| `src/shared/`           | Toolkit-independent contracts, enums, constants, and pure helpers.      |
| `src/shell/`            | GNOME Shell, MPRIS, panel, popup, and extension-lifetime owners.        |
| `src/prefs/`            | GTK4/Libadwaita window, bindings, controllers, and widgets.             |
| `assets/`               | Schemas, GtkBuilder UI, D-Bus XML, translations, and bundled images.    |
| `scripts/` and `tests/` | Development-time validation, packaging, and behavior/contract coverage. |

`src/shared/` does not import GNOME Shell, GTK, or other process-specific APIs. Shell and Preferences do not import each other. Their common boundary is the schema, compiled resources, and shared toolkit-independent modules.

The installable extension contains runtime files and compiled artifacts only. Documentation, tests, source catalogs, screenshots, and development tooling are not part of the runtime package.

## Entrypoints and lifecycle roots

`extension.js` owns no runtime service or UI. It creates one `ExtensionController` per enabled lifecycle and delegates teardown to that controller. `ExtensionController` constructs dependencies before consumers, rejects stale startup work through a lifecycle generation, and tears down owned resources in dependency-safe order.

`prefs.js` validates the Preferences runtime, initializes translation dispatch, and delegates window construction to `PreferencesController`. The controller owns the window composition, settings bindings, page/dialog controllers, and window-scoped teardown.

Module scope is limited to immutable data, pure functions, and state explicitly valid for the whole process. Extension-lifetime resources must have an owner and cleanup path. Process-lifetime adapters are allowed only when their behavior is intentionally idempotent; Preferences resource registration and translation dispatch use that model.

The component that creates a signal connection, GLib source, cancellable, asynchronous generation, actor, or private API override owns its cleanup.

## Shell ownership

| Owner                              | Architectural responsibility                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExtensionController`              | Extension lifecycle, dependency construction, settings impact dispatch, global shortcuts, optional Shell patching, and top-level UI mounting. |
| `SettingsStore`                    | Typed runtime settings reads and change subscriptions.                                                                                        |
| `MprisProxyFactory`                | Construction of the D-Bus proxies used by MPRIS owners.                                                                                       |
| `MediaAppRegistry`                 | Endpoint discovery, lifetime tracking, blocked-app filtering, and active-media-app selection.                                                 |
| `MprisMediaApp`                    | One MPRIS endpoint: proxies, confirmed state, capabilities, operations, writes, and endpoint signals.                                         |
| `PlaybackPositionTracker`          | Playback-position projection from confirmed endpoint state and monotonic time.                                                                |
| `DesktopAppResolver`               | Mapping endpoint identity to installed desktop/browser/PWA identity; it does not own endpoint lifetime.                                       |
| `MediaShellIndicator`              | Panel actor, popup-menu boundary, active-endpoint bindings, and coalesced surface updates.                                                    |
| `TopBarContent` and `PopupContent` | Independent coordination and teardown of their surface components.                                                                            |
| `AlbumArtLoader`                   | Shared local/remote artwork access, in-flight request reuse, and bounded cache ownership.                                                     |

Long-lived asynchronous owners use cancellables, generation checks, active-owner checks, or equivalent tokens. A result created for an old endpoint, actor, window, or extension lifecycle cannot update its replacement.

## MPRIS state and control flow

D-Bus ownership of `org.mpris.MediaPlayer2.*` names is authoritative for endpoint lifetime. Desktop identity, browser/PWA identity, metadata, blocked applications, and user pinning affect filtering, presentation, or selection without replacing D-Bus ownership as the lifetime source.

Discovery and endpoint ownership remain separate from active-app selection. The registry delegates selection decisions to deterministic policy functions, allowing discovery, selection, and presentation to evolve independently.

Playback actions use one path:

```text
control definition and state decision
  -> surface component
  -> playbackControlExecutor
  -> MprisMediaApp
  -> MPRIS endpoint
```

Surface code does not call endpoint proxies directly. Endpoint capabilities and confirmed properties determine whether an operation is available and which state is presented. UI components consume `PlaybackPositionTracker` instead of maintaining independent playback clocks.

## Shell surfaces and sharing

Popup and Top Bar have different actor trees, geometry, interaction, visibility, and teardown. `PopupContent` can defer work while its menu is closed; `TopBarContent` reconciles ordered panel elements. `MediaShellIndicator` binds both to the same active `MediaApp` and coalesces invalidations before dispatching surface updates.

Their parallel components are intentional:

- Popup and Top Bar playback controls consume common definitions, state decisions, accessibility data, and execution, but own their buttons and lifecycle independently.
- Track-information components share normalization and ordering contracts while retaining surface-specific presentation and layout.
- Artwork components share loading, decoding, and stateless presentation helpers while separately owning actors, request generations, cancellation, geometry, and animation.

Shared appearance or method names alone do not justify a base class or shared actor renderer. Implementation is shared only when inputs, outputs, side effects, ownership, teardown, and expected evolution are all the same.

## Settings and Preferences

GSettings is the persisted contract between Shell and Preferences. Schema keys, defaults, ranges, and enum values are represented by shared definitions and consumed through process-specific owners.

Shell reads and subscribes through `SettingsStore`; settings impact metadata determines which runtime region is updated or rebuilt. Preferences uses `PreferenceBinder` for direct and converted widget bindings and page controllers for behavior that is not a simple binding. Initial synchronization is read-only unless an explicit migration owns a write.

GtkBuilder resource paths, object IDs, widget classes, custom `GTypeName` values, CSS classes, and schema identifiers are compatibility-sensitive boundaries between declarative assets and JavaScript.

## Metadata and artwork

MPRIS metadata is untrusted input and is normalized before identity, selection, or presentation logic uses it. Track identity prefers the strongest endpoint-provided identity and falls back conservatively when implementations are incomplete.

Artwork is divided by ownership:

- `AlbumArtLoader` owns source access, shared in-flight work, cache reads/writes, pruning, and extension-lifetime cancellation;
- utilities own source normalization, decoding, and stateless presentation calculations;
- Popup and Top Bar artwork components own presentation actors, request generations, cancellation, geometry, and teardown.

This separation allows source/cache reuse without sharing surface actors or accepting stale results.

## Visualizer

The visualizer follows the same separation between portable decisions, Shell presentation, drawing, and lifecycle:

- shared visualizer modules define style values, normalization, and frame calculations without importing Shell APIs;
- Shell visualizer constants define renderer mappings, geometry, and timing used by the panel implementation;
- `TopBarVisualizer` is the sole owner of actors, playback/animation state, the `Clutter.Timeline`, repaint callbacks, attachment, and teardown;
- `topBarVisualizerDrawing.js` performs stateless Cairo drawing from complete frame data and owns no actor, signal, timer, or animation clock.

`TopBarContent` creates the visualizer only when enabled and destroys that owner when disabled. A visualizer style may add drawing or frame behavior, but it must not add another scheduler, settings path, or lifecycle root.

## Stable external boundaries

Changes to the following require explicit compatibility or migration analysis:

- extension identity and supported GNOME versions;
- GSettings keys, types, defaults, ranges, and enum values;
- MPRIS and D-Bus interface members;
- resource paths, GtkBuilder IDs/classes, CSS classes, and `GTypeName` strings;
- persisted input-action values and playback-control IDs;
- package layout expected by GNOME installation and review tooling.

## Private GNOME Shell API

`GnomeShellMediaControlsPatch` is the isolated compatibility boundary for the optional integration with GNOME Shell internals. Private API access must remain capability-checked, reversible, and limited to that feature. It must not leak into general MPRIS or UI ownership.
