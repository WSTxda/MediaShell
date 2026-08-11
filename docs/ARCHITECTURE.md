# Architecture

MediaShell is organized by process boundary and ownership. GNOME Shell owns the runtime UI and MPRIS integration, Preferences owns the GTK4/Libadwaita interface, and shared code contains toolkit-independent contracts and helpers.

The installable archive contains runtime files only. Documentation, tests, screenshots, source catalogs, and development tooling stay outside the extension package.

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

`src/shared/` must not import GNOME Shell or GTK. Shell and Preferences communicate through shared contracts, GSettings, and compiled resources; they do not import each other.

## Runtime ownership

- `ExtensionController` owns enable/disable ordering, settings, services, registry creation, and top bar mounting.
- `MediaAppRegistry` owns D-Bus discovery and active media-app selection.
- `MprisMediaApp` owns one MPRIS endpoint: method calls, property writes, cached properties, capabilities, and signals.
- `PlaybackPositionTracker` projects playback position from confirmed endpoint state, track identity, rate, and monotonic time.
- `DesktopAppResolver` maps MPRIS identity to installed applications and browser/PWA desktop entries.
- `MediaShellIndicator` owns the panel indicator and popup. `TopBarContent` owns the top bar surface, while components under `ui/topBar/` and `ui/popup/` own their respective actors and teardown.
- `AlbumArtLoader` owns local/cache/network I/O and shared remote requests. `PopupAlbumArt` and `TopBarAlbumArt` own their surface actors, request generations, cancellation, and fallback presentation.
- `PreferencesController` owns GtkBuilder, bindings, page controllers, custom widgets, and Preferences teardown. `PopupLayoutController` provides user-driven width feedback when seek controls require the popup minimum.

The component that creates a signal, GLib source, cancellable, asynchronous generation, actor, or private API override owns its cleanup.

## Lifecycle

`ExtensionController.enable()` initializes resources, settings, services, shortcuts, and the MPRIS registry before mounting the UI. `destroy()` tears them down in reverse ownership order and invalidates pending asynchronous work.

`lifecycleGeneration` prevents callbacks from an older enable/destroy cycle from mutating current state. Local generation counters and cancellables provide the same protection for component-owned asynchronous work.

## MPRIS model and selection

`MediaAppRegistry` watches `org.mpris.MediaPlayer2.*` names. D-Bus ownership defines endpoint lifetime; desktop and browser identity improve presentation, blocked-app matching, and media-app actions without replacing that authority.

Active selection is deterministic: pinned, playing, previous active, paused, then the first valid endpoint. Pinning is runtime-only. Owner and metadata grace periods preserve useful state during short hand-offs.

Playback commands follow one path:

```text
control definition and state policy
  -> popup or top bar renderer
  -> executePlaybackControlAction()
  -> MprisMediaApp
  -> MPRIS
```

Popup and top bar have separate actor trees. They share pure decisions and execution paths only when the contracts are identical. Actor creation, placement, styling, and teardown remain surface-owned.

Shell updates are coalesced. Popup regions invalidated while the popup is closed are synchronized when it opens. Preserve this behavior when changing update propagation.

Relative seek controls use `Seek(x)`. Position changes from the progress control use `SetPosition(ox)`. Playback-speed UI reflects the rate confirmed by the MPRIS endpoint.

## Metadata and artwork

Treat MPRIS metadata as untrusted input. `MprisMediaApp` normalizes values before they reach the UI and prefers `mpris:trackid` for track identity, with a conservative fallback for incomplete endpoints.

Artwork responsibilities are intentionally split:

- `AlbumArtLoader` handles bounded local/cache/network I/O, shared in-flight requests, cache recovery, and persistent storage.
- `shell/utils/albumArtSource.js`, `albumArtDecode.js`, `albumArtPixbuf.js`, and `albumArtPresentation.js` share source, decode, and stateless presentation policy.
- `PopupAlbumArt` and `TopBarAlbumArt` independently own actors, request generations, cancellation, layout, and teardown.

Late asynchronous results must be rejected when their generation, lifecycle, or active endpoint is no longer current.

Compressed artwork input is limited to 16 MiB per image. The optional persistent cache is limited to 128 MiB and evicts the least recently used entries first; cache hits refresh recency asynchronously without delaying artwork rendering.

## Stable contracts

Preserve compatibility-sensitive values unless a migration is intentional and documented:

- extension identity and supported GNOME versions;
- GSettings keys and enum values;
- MPRIS and D-Bus members;
- resource paths and GtkBuilder IDs/classes;
- CSS classes and `GTypeName` strings;
- persisted input-action values and playback-control IDs;
- package contents.

Constant modules contain values and frozen declarative data. Reusable normalization, comparison, and resolution behavior belongs under `utils/`. Process-specific policy and runtime state stay with their owner.

Share implementation only when inputs, outputs, side effects, ownership, lifecycle, teardown, and expected evolution are the same. Similar-looking code may remain separate by design.

## Validation boundaries

Development tooling validates facts it can determine exactly: JavaScript parsing, static imports and exports, process boundaries, stable entry points, removed APIs, schema/UI/D-Bus consistency, playback table references, assets, translations, and package contents. GtkBuilder IDs are scoped to the `.ui` file that owns them; references made through the main Preferences builder are checked specifically against `prefs.ui`.

Behavior tests cover pure decisions, compatibility-sensitive values, owner transitions, cancellation, stale-result rejection, and package corruption. Tooling does not infer ownership, teardown reachability, naming quality, or dead code from method names and source patterns; those remain review and live-testing responsibilities. Translation checks require source/template parity, valid headers, and safe placeholders, while incomplete locale coverage may fall back to the source language and is compiled by the native gettext gate.

The shared logger is runtime infrastructure, not a validation mechanism. It centralizes important failures and bounded once-only diagnostics without logging normal successful operation.

## Private GNOME Shell API

`GnomeShellMediaControlsPatch` isolates the optional modification of GNOME's native media controls. Other unavoidable private Shell access must remain local, capability-checked, reversible, documented beside the code, and tested on supported GNOME releases.
