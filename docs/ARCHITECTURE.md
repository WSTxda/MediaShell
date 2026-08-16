# Architecture

MediaShell is organized around process boundaries and ownership. GNOME Shell owns runtime UI and MPRIS integration, Preferences owns the GTK4/Libadwaita interface, and shared code contains toolkit-independent contracts and helpers.

The installable extension contains runtime files only. Documentation, tests, screenshots, source catalogs, and development tooling remain outside the packaged extension.

## Repository layout

```text
src/
  extension.js                 GNOME Shell entry point
  prefs.js                     Preferences entry point
  metadata.json                Extension manifest
  stylesheet.css               Shell styles
  shared/                      Toolkit-independent contracts and helpers
  shell/                       GNOME Shell runtime
  prefs/                       GTK4/Libadwaita Preferences runtime
assets/                        UI templates, schema, D-Bus XML, translations, and images
scripts/                       Validation, packaging, and development utilities
tests/                         Behavior and cross-file integrity tests
```

`src/shared/` must not import GNOME Shell or GTK. Shell and Preferences do not import each other; GSettings, resources, and shared contracts are the boundary between the two processes.

## Runtime ownership

- `ExtensionController` owns extension lifecycle ordering, settings, services, media-app discovery, shortcuts, and top-level UI mounting.
- `MediaAppRegistry` owns MPRIS endpoint discovery, lifetime tracking, and active media-app selection.
- `MprisMediaApp` owns one MPRIS endpoint: proxies, cached endpoint state, capabilities, methods, property writes, and endpoint signals.
- `PlaybackPositionTracker` owns projected playback position derived from confirmed endpoint state and monotonic time.
- `DesktopAppResolver` maps MPRIS identity to installed desktop applications and browser/PWA entries without becoming authoritative for endpoint lifetime.
- `MediaShellIndicator` owns the panel indicator and popup surface. Top-bar and popup components own their own actors, signal connections, and teardown.
- `AlbumArtLoader` owns artwork I/O and reusable loading/cache work. Surface artwork components own presentation, request generations, cancellation, and actors.
- `PreferencesController` owns the Preferences window composition, page controllers, bindings, custom widgets, and Preferences teardown.

The component that creates a signal connection, GLib source, cancellable, asynchronous generation, actor, or private API override owns its cleanup.

## Lifecycle and asynchronous work

`ExtensionController.enable()` builds runtime dependencies before mounting UI. `destroy()` releases them in reverse ownership order and invalidates work that belongs to the previous lifecycle.

Long-lived asynchronous owners use generation checks, cancellables, or equivalent ownership tokens so a result cannot mutate state after its endpoint, actor, or extension lifecycle has been replaced. Cleanup belongs with the resource owner rather than a distant coordinator.

Module scope is reserved for immutable values, declarative data, functions, and other state that is safe for the lifetime of the module. Runtime objects with lifecycle or teardown requirements belong to an explicit owner.

## MPRIS model and control flow

`MediaAppRegistry` treats D-Bus ownership of `org.mpris.MediaPlayer2.*` names as the authority for endpoint lifetime. Desktop identity, browser identity, metadata, and user pinning inform presentation and selection without replacing that authority.

Active media-app selection is resolved by a deterministic policy from valid endpoints and current runtime state. Selection policy remains separate from discovery and from UI rendering so endpoint lifetime, selection, and presentation can evolve independently.

Playback actions follow one path:

```text
control definition and state policy
  -> surface renderer
  -> executePlaybackControlAction()
  -> MprisMediaApp
  -> MPRIS endpoint
```

Surface code does not bypass `MprisMediaApp` to issue endpoint operations. Endpoint capabilities and confirmed properties determine whether an operation is available and what state the UI presents.

Relative seek operations use the MPRIS relative-seek method. Absolute position changes are tied to the current track identity as required by MPRIS. Position projection is owned by `PlaybackPositionTracker`; UI components consume that state rather than implementing independent clocks.

Popup and top bar have separate actor trees. They share declarative control definitions, pure state decisions, and execution paths where the contracts are identical, while actor creation, placement, styling, interaction, and teardown remain surface-owned.

Shell UI updates are coalesced. State invalidated while a surface is not visible is synchronized when that surface becomes active rather than forcing unnecessary actor work.

## Settings and Preferences

GSettings is the persisted contract shared by Shell and Preferences. Keys and enum values originate from the schema and corresponding shared definitions; runtime and Preferences code consume those contracts through their process-specific owners.

Shell settings connections belong to `SettingsStore` and the runtime owners that consume them. Preferences bindings belong to `PreferenceBinder` and page controllers. Initialization must not turn widget synchronization into unintended writes; persisted changes should originate from explicit user actions or deliberate migration logic.

GtkBuilder templates, resource paths, widget IDs, and custom `GTypeName` values are compatibility-sensitive interfaces between declarative resources and JavaScript.

## Metadata and artwork

MPRIS metadata is untrusted input. Normalize and validate endpoint-provided values before they reach presentation or identity logic. Track identity should use the strongest MPRIS identity available and fall back conservatively when endpoints are incomplete.

Artwork responsibilities are intentionally split:

- loading/cache services own source access, shared requests, recovery, and storage policy;
- pure utilities own source normalization, decoding decisions, and stateless presentation calculations;
- popup and top-bar components independently own actors, layout, cancellation, request generations, and teardown.

Late artwork results must be rejected when the request owner, active endpoint, or extension lifecycle is no longer current.

## Stable contracts and sharing

Preserve compatibility-sensitive values unless a migration or compatibility break is intentional and documented:

- extension identity and supported GNOME versions;
- GSettings keys and enum values;
- MPRIS/D-Bus interface members;
- resource paths and GtkBuilder IDs/classes;
- CSS classes and `GTypeName` strings;
- persisted input-action values and playback-control IDs;
- package contents expected by installation and review tooling.

Constant modules contain pure values and frozen declarative data. Runtime objects and owner-specific state stay with their owner. Reusable normalization, comparison, and resolution logic belongs in utilities when it is genuinely shared.

Share implementation only when inputs, outputs, side effects, ownership, lifecycle, teardown, and expected evolution are the same. Similar-looking UI or lifecycle code may remain separate when those contracts differ.

## Validation boundary

Development tooling validates facts that can be established deterministically: syntax and module boundaries, stable references, declarative contract consistency, resource and translation integrity, and package contents. Behavior tests cover pure decisions, persisted/external contracts, ownership transitions, cancellation, stale-result rejection, and corruption cases that can be reproduced reliably.

Validators do not infer architectural quality, ownership correctness, lifecycle reachability, naming quality, or dead code from source shape. Those require code review and live GNOME testing.

## Private GNOME Shell API

`GnomeShellMediaControlsPatch` contains the optional integration that depends on GNOME Shell internals. Private Shell access must remain isolated, capability-checked, reversible, and scoped to the feature that requires it. Changes to that boundary require live testing on every supported GNOME release.
