# Architecture

MediaShell is organized around process boundaries and resource ownership. This document describes the durable structure of the project, not individual feature behavior. Development conventions belong in [Development](DEVELOPMENT.md), and contribution requirements belong in [Contributing](../CONTRIBUTING.md).

## Repository boundaries

| Path                 | Responsibility                                                                  |
| -------------------- | ------------------------------------------------------------------------------- |
| `src/extension.js`   | GNOME Shell entrypoint.                                                         |
| `src/prefs.js`       | Preferences entrypoint.                                                         |
| `src/shared/`        | Toolkit-independent contracts and pure helpers shared by Shell and Preferences. |
| `src/shell/`         | GNOME Shell runtime, MPRIS, media capabilities, integrations, and Shell UI.     |
| `src/prefs/`         | GTK4/Libadwaita preferences UI and controllers.                                 |
| `assets/`            | Metadata, schemas, resources, translations, and bundled assets.                 |
| `scripts/`, `tests/` | Development, validation, packaging, and behavioral/contract checks.             |

`src/shared/` does not import Shell, GTK, Libadwaita, or other process-specific APIs. Shell and Preferences do not import each other; GSettings, compiled resources, and shared contracts are their common boundary.

## Lifecycle and ownership

`extension.js` creates one `ExtensionController` for an enabled extension lifecycle. The controller composes extension-owned resources and the Shell runtime; it does not become the owner of domain behavior that belongs below it.

The component that creates a signal connection, GLib source, cancellable, asynchronous generation, actor, cache, or private API override owns its cleanup. Work that can finish after its owner is replaced must be cancelled or rejected as stale.

The canonical media runtime survives session-profile changes such as lock/unlock while user-facing Shell integrations are reconciled for the active profile.

## Shell media runtime

`MediaRuntime` is the capability boundary shared by Shell consumers. It composes MPRIS discovery and selection with playback, artwork, desktop identity, and application actions so UI surfaces do not create their own protocol or media services.

```text
MPRIS / D-Bus
    ↓
MprisPlayerRegistry
    ↓
MediaRuntime
    ├── playback
    ├── artwork
    ├── identity
    └── application
         ↓
Shell consumers
```

A capability may depend on another capability, but presentation code must not become authoritative for media state.

## MPRIS and D-Bus

Ownership of `org.mpris.MediaPlayer2.*` names on the session bus is authoritative for player lifetime. `MprisPlayer` owns the proxies and confirmed state of one endpoint; the registry owns endpoint discovery, lifetime, filtering, and active-player selection.

MPRIS metadata is normalized at the protocol boundary into the canonical Track representation used downstream. Capabilities and confirmed endpoint properties determine whether controls are available. Desktop application or browser/PWA identity may improve presentation and application actions, but it never replaces D-Bus ownership as the source of player lifetime.

Playback position uses confirmed MPRIS state and monotonic time rather than an independent polling clock in each surface. Discontinuities are reconciled from the endpoint before projected state is exposed again.

## Media capabilities

Playback commands use the shared playback capability rather than calling MPRIS proxies from surfaces. This keeps command semantics and operation results consistent across Popup, Top Bar, shortcuts, and other consumers.

Artwork acquisition and persistent caching are shared capabilities. Surface artwork components own only presentation state, request generations, geometry, and actor lifecycle.

Desktop identity resolves an MPRIS endpoint to installed application identity for presentation and supported application actions. Window resolution is conservative: exact application/PWA evidence may improve Raise behavior, while ambiguous cases fall back to the normal MPRIS action instead of redefining player identity.

## Shell UI

Popup and Top Bar consume the same media runtime but own separate actor trees, geometry, visibility, interaction, reconciliation, and teardown. Shared domain decisions and stateless primitives may be reused; actors and lifecycle are shared only when their complete ownership contract is the same.

Transient feedback uses the native GNOME OSD integration. Feature code supplies presentation data while GNOME-specific compatibility stays behind the integration boundary.

## Settings and Preferences

GSettings is the persisted contract between Shell and Preferences. Shared settings definitions describe stable keys and values; Shell and Preferences use process-specific owners to consume them.

Preferences uses GTK4/Libadwaita and GtkBuilder resources. Schema keys, resource paths, GtkBuilder IDs, custom `GTypeName` values, CSS classes, and other declarative identifiers are compatibility-sensitive contracts and require deliberate migration when changed.

## Private GNOME Shell APIs

Private Shell access is isolated under `src/shell/private/gnome/` and reached through public MediaShell integration boundaries. Private integrations must be capability-checked, reversible, and fail safely when a supported Shell version does not provide the expected internal contract.

Private API details must not leak into MPRIS, shared media capabilities, or general surface ownership.

## Stable contracts

Changes to these areas require explicit compatibility analysis:

- extension UUID, metadata, supported GNOME versions, and package layout;
- GSettings keys, types, ranges, defaults, and persisted enum/action values;
- MPRIS/D-Bus interface names and protocol values;
- resource paths, GtkBuilder IDs/classes, CSS classes, and `GTypeName` strings.

## References

- [MPRIS specification](https://specifications.freedesktop.org/mpris/latest/)
- [GNOME Shell extension development](https://gjs.guide/extensions/)
- [GNOME extension review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
- [GNOME extension best practices](https://gjs.guide/extensions/review-guidelines/best-practices.html)
