# Architecture

MediaShell 3.0 is organized around **process boundaries, domain ownership, and explicit capabilities**. MPRIS/D-Bus supplies authoritative media state; the MediaShell runtime turns that state into reusable playback, artwork, and identity capabilities; Shell surfaces compose those capabilities without reimplementing protocol behavior. Preferences is a separate GTK4/Libadwaita process and communicates with the Shell runtime through GSettings and shared toolkit-independent contracts.

This document describes the durable architecture. Implementation conventions and validation commands live in [Development](DEVELOPMENT.md); contributor obligations live in [Contributing](../CONTRIBUTING.md).

## Design rules

1. **Behavior is more stable than implementation shape.** A refactor may rename, move, split, merge, or replace internal code, but it must not accidentally discard grace periods, stale-result rejection, lifecycle cleanup, incremental UI updates, protocol semantics, or compatibility fallbacks.
2. **The owner of a resource owns its teardown.** Signals, GLib sources, cancellables, actors, private API overrides, asynchronous generations, caches, and sessions are destroyed by the object that creates them.
3. **MPRIS/D-Bus owns endpoint truth.** Desktop application identity may corroborate presentation and app actions; it does not decide whether an MPRIS endpoint exists.
4. **Shared means cross-process or toolkit-independent.** Code used by Popup and Top Bar is not automatically `shared`; both surfaces run in the Shell process and normally reuse Shell media/UI capabilities instead.
5. **Surfaces compose capabilities.** Popup, Top Bar, native GNOME media integration, and any future surface consume the same runtime instead of adding new MPRIS, artwork, cache, selection, or playback implementations.
6. **Private Shell APIs are quarantined.** The MediaShell core never imports its private GNOME Shell adapters. Private adapters consume the public MediaShell runtime and absorb version-specific Shell internals.

## Repository and process boundaries

| Path               | Responsibility                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `src/extension.js` | GNOME Shell entrypoint. Creates the extension lifecycle controller only from `enable()`.                |
| `src/prefs.js`     | Preferences entrypoint for the separate GTK4/Libadwaita process.                                        |
| `src/shared/`      | Toolkit-independent contracts and pure behavior that may be consumed across processes.                  |
| `src/shell/`       | GNOME Shell runtime, MPRIS, media capabilities, Shell UI, input, resources, and integrations.           |
| `src/prefs/`       | Preferences window composition, bindings, controllers, widgets, catalogs, and maintenance services.     |
| `assets/`          | GSettings schema, GtkBuilder UI, D-Bus introspection XML, translations, images, and gresource manifest. |
| `scripts/`         | Validation, packaging, metadata, resource, translation, and development tooling.                        |
| `tests/`           | Observable behavior and stable-contract coverage.                                                       |

The dependency direction is intentionally one-way:

```text
shared
  ↑
  ├──────── prefs
  │
  └──────── shell domains
              ↑
              ├── UI components
              │      ↑
              │   surfaces
              │
              └── public integrations ← private GNOME adapters
```

Forbidden examples include `shared → shell`, `shared → prefs`, `shell → prefs`, `prefs → shell`, `mpris → ui`, `components → popup/topbar`, and `core → private`. The development validator enforces the important process/private boundaries.

## Extension lifecycle and runtime profiles

`extension.js` is deliberately small. `ExtensionController` is the Shell composition root for one enabled extension lifecycle.

It owns extension-lifetime resources:

- `ResourceRegistry`;
- `MediaShellSettings`;
- session-mode subscription;
- one `NativeMediaControlsIntegration` boundary.

It reconciles one runtime profile at a time:

```text
GNOME session mode
      ↓
ExtensionController
      ├── user
      │    ├── MediaRuntime
      │    ├── InputActionDispatcher
      │    ├── GlobalShortcuts
      │    ├── MediaShellIndicator
      │    └── native integration
      │
      ├── unlock-dialog
      │    ├── MediaRuntime only when Enhanced mode is supported and enabled
      │    └── native lock-screen enhancement
      │
      └── other modes
           └── no MediaShell runtime
```

Profile changes are serialized and generation-guarded. A stale asynchronous startup cannot mutate a replacement profile. Teardown runs before a different profile is mounted.

`ExtensionController` does **not** implement MPRIS, artwork, player selection, playback operations, private Shell integration, or per-surface rendering. Those responsibilities belong to the domains below.

## MediaRuntime: the Shell media capability boundary

`src/shell/runtime/mediaRuntime.js` composes the reusable media runtime for one profile:

```text
MediaRuntime
├── MprisProxyFactory
├── MprisPlayerRegistry
├── PlaybackController
├── ArtworkService
└── DesktopAppResolver
```

Consumers receive the runtime or the narrow capability they need. A new Shell surface should be able to consume `activePlayer`, player selection, playback, artwork, and identity without changing the MPRIS implementation.

`MediaRuntime` also owns media-wide settings such as the blocked-app set and artwork-cache state. Surfaces do not interpret those settings themselves.

## MPRIS and D-Bus

All endpoint/protocol implementation lives under `src/shell/mpris/`.

### Protocol vocabulary

`protocol.js` defines the exact MPRIS/D-Bus interface names, property names, object paths, enum-like values, and metadata keys required by the specification. Protocol-facing strings retain their official spelling (`PlaybackStatus`, `CanSeek`, `SetPosition`, `mpris:artUrl`, and so on) even though JavaScript-facing accessors use project naming conventions.

### MprisPlayer

`player.js` represents one owned `org.mpris.MediaPlayer2.*` endpoint. It owns:

- root/player/properties proxies;
- well-known bus name and current unique owner;
- canonical player/root state and capabilities;
- normalized Track metadata;
- one `MprisPositionTracker`;
- owner and asynchronous generations;
- endpoint signal connections;
- MPRIS operations.

The player is a stateful client object, not a thin `Gio.DBusProxy` wrapper.

### Endpoint validity and browser grace

`clientPolicy.js` contains client-side lifecycle policy, including the bounded grace periods used for imperfect real-world players.

When a previously valid player briefly publishes empty Metadata while `STOPPED`, MediaShell retains the last stable Track during the grace interval. Repeated empty updates do not extend the interval indefinitely. If real metadata returns, the grace is cancelled; if the endpoint remains empty/stopped, the player becomes invalid. This protects browser feeds and rapid media transitions without inventing permanent state.

A separate owner-disappearance grace allows controlled D-Bus owner handoff without needlessly destroying a player surface during a process replacement.

Initial metadata polling, invalidated-property refresh, owner generations, cancellables, and stale-response checks remain part of the MPRIS lifecycle contract.

### Canonical Track

`metadata.js` converts untrusted MPRIS `a{sv}` Metadata into a canonical immutable-style Track snapshot. UI code must consume fields such as:

```text
track.id
track.title
track.artists
track.album
track.albumArtists
track.artUrl
track.url
track.lengthMicroseconds
```

Presentation code must not repeatedly parse raw `mpris:*` or `xesam:*` keys.

### Position

`position.js` contains pure position/rate/track-context mathematics. `positionTracker.js` owns the live MPRIS position lifecycle.

MPRIS does not continuously emit `PropertiesChanged` as Position advances. MediaShell therefore projects the last authoritative Position with monotonic time and `Rate` while playing, keeps it stationary while paused, refreshes when required, and treats `Seeked` as an authoritative discontinuity.

`SetPosition` remains track-aware: it is used only when control/seek capability and a valid current TrackId allow it, so a stale seek cannot be applied to a replacement track.

### Registry and selection

`registry.js` owns bus-name discovery, player creation/removal, owner handoff, blocklist application, pin state, active-player lifetime, and callbacks. `selection.js` keeps deterministic selection/cycling policy pure and independently testable.

Desktop app identity is **not** the endpoint lifecycle authority.

## Playback domain

`src/shell/media/playback/` is the canonical MediaShell interpretation of playback controls.

```text
MprisPlayer state/capabilities
          ↓
   controlState / progress
          ↓
Popup / Top Bar / native adapter / input
          ↓
   PlaybackController
          ↓
       MprisPlayer
          ↓
         D-Bus
```

`PlaybackController` is the single execution boundary for user intent: play/pause, next/previous, seek, absolute position, shuffle, loop, speed, volume, raise, quit, and player switching where appropriate. Surfaces do not duplicate the operation policy.

The shared control catalog describes stable control/action vocabulary. Each surface remains free to expose a different subset and presentation; for example, playback-speed controls may exist in Popup without existing in Top Bar.

## Artwork domain

Artwork is a runtime capability because it adds I/O, cache state, decoding, cancellation, and shared asynchronous work on top of MPRIS metadata.

```text
MPRIS Metadata
      ↓
canonical Track
      ↓
createArtworkRequest()
      ↓
ArtworkService
      ├── local source / thumbnail
      ├── remote HTTP request
      ├── in-flight request reuse
      ├── payload validation
      ├── decode/fallback
      └── ArtworkCache
              ├── bounded persistent cache
              ├── serialized access
              └── coalesced pruning
```

Popup, Top Bar, and native enhancement request artwork from the same service. They do not know whether the result came from disk, network, a local file, a thumbnail, or another consumer's in-flight request.

Each visual owner still owns its own actor, geometry, request generation, cancellable, animation, and stale-result rejection because those lifecycles are surface-specific.

## Desktop identity and PWA resolution

`src/shell/media/identity/` converts MPRIS identity hints into GNOME desktop presentation identity.

Exact `DesktopEntry` evidence is preferred. Browser/PWA parsing/scoring is separated from Shell-specific app enumeration; the toolkit-independent parsing primitives live in `src/shared/identity/`, while Shell/PWA resolution lives under the Shell identity domain.

Identity may supply app icon, display name, raise/quit corroboration, and browser/PWA presentation. It never replaces the D-Bus owner as MPRIS lifecycle truth.

## Settings architecture

The XML GSettings schema is the persisted configuration contract. `src/shared/settings/contract.js` defines canonical key names, modes, defaults, and bounds so Shell, Preferences, and validation do not retype independent vocabularies.

The Shell runtime exposes owner-scoped views:

```text
MediaShellSettings
├── popup        → PopupContent
├── topBar       → TopBarContent
├── panel        → ExtensionController / panel placement
├── interactions → pointer/input behavior
├── integration  → native media controls mode
├── media        → MediaRuntime blocklist/artwork cache
└── keybindings  → GNOME global shortcut registration
```

There is no global settings-to-widget action table and no property injection onto `ExtensionController`. Each owner observes only the settings it understands and converts a relevant change into its own local reconciliation.

Native GNOME media controls use one exclusive mode (`default`, `hidden`, or `enhanced`) rather than conflicting Hide/Enhance booleans.

## UI surfaces and incremental reconciliation

Popup and Top Bar are independent surfaces. They share media capabilities and reusable UI primitives only when the complete semantic/lifecycle contract matches.

Each surface owns a local bitmask of dirty regions and one `CoalescedUpdateQueue` backed by `GLib.idle_add()`:

```text
MPRIS/settings burst
       ↓
Indicator or local settings listener
       ↓
Popup regions          Top Bar regions
       ↓                      ↓
local idle queue       local idle queue
       ↓                      ↓
update affected actors only
```

`MediaShellIndicator` translates active-player changes into independent surface updates; it does not own the surfaces' dirty masks or idle sources.

Important preserved behavior:

- enabling/disabling one playback control creates/removes only that control actor;
- unrelated artwork, labels, controls, and surfaces are not rebuilt;
- MPRIS bursts are coalesced before rendering;
- a closed Popup stores dirty regions instead of rendering hidden content;
- opening the Popup merges deferred regions with mandatory initial regions and reconciles once;
- active-player handoff reconciles existing surfaces instead of recreating them unnecessarily.

Reusable Shell presentation primitives live under `src/shell/ui/components/`. Surface-specific geometry, ownership, animation, and actor trees remain under `popup/` or `topbar/`.

## Visualizer

`TopBarVisualizer` remains the single owner of visualizer lifecycle, timeline, reduced-motion state, theme state, and renderer selection. Renderer-specific drawing/physics is split under `ui/components/visualizer/renderers/` so Beats/Pulse, Classic, Spectrum, and Vinyl can evolve independently without creating multiple lifecycle owners.

## Private GNOME Shell integration

Normal MediaShell code reaches private Shell behavior only through public integration boundaries:

```text
shell/integrations/nativeMediaControls.js
        ↓
private/gnomeShell/mediaControls/adapter.js

shell/integrations/panelMenu.js
        ↓
private/gnomeShell/panelMenu/compatibility.js
```

All direct notification-media internals are confined to the media-controls compatibility module. PanelMenu `_clickGesture` compatibility is confined to its own adapter. The validator rejects direct imports of the private tree from other normal modules.

Hidden and Enhanced integrations are consumers of MediaShell capabilities. Enhanced notification/lock-screen presentation receives injected player, playback, and artwork capabilities; it does not become a second MPRIS implementation. Unsupported private structures fail open by preserving/restoring native GNOME behavior.

## Preferences process

Preferences runs separately from GNOME Shell using GTK4 and Libadwaita. It consumes shared contracts and GSettings, not Shell modules.

GtkBuilder handles declarative composition and simple settings binding. Controllers/widgets own behavior that cannot be expressed as a plain binding, including ordered content, shortcuts, blocklist selection, sensitivity, cache maintenance, and dialogs.

Preferences services own their I/O and cancellables. Artwork cache maintenance uses asynchronous Gio enumeration and treats `NOT_FOUND` as an empty cache rather than performing a synchronous existence pre-check.

## Asynchronous ownership and stale work

Every asynchronous path must define the state that makes its result current. Common mechanisms include:

- lifecycle generation in `ExtensionController`;
- owner/request generations in `MprisPlayer`;
- refresh generations in `MprisPositionTracker`;
- request generations and cancellables in artwork presentation owners;
- consumer-aware in-flight request cancellation in `ArtworkService`;
- cancellables in Preferences I/O.

A late result is discarded if its owner, bus owner, track, request, actor, window, profile, or extension lifecycle was replaced.

## Logging

Use `createLogger(scope)` from `src/shared/logging/logger.js`. Log failures, compatibility fallbacks, unexpected protocol data, recovery, and diagnostics that help investigate a real problem. Avoid routine high-frequency playback/position logging.

Use `warnOnce`/`errorOnce` for recurring failure paths where repeated journal entries would add noise without additional information.

## Adding a new Shell surface

A new surface should normally need only:

1. the existing `MediaRuntime` or narrow capabilities from it;
2. its own scoped settings if configuration is required;
3. reusable UI components where their lifecycle matches;
4. its own surface-local actor tree, dirty regions, reconciliation, and teardown.

Adding a surface should **not** require a new MPRIS registry, artwork loader/cache, metadata parser, position tracker, playback executor, or desktop identity resolver. If it does, first verify whether the new surface is bypassing an existing capability.

## Behavior-preservation rule

Before removing, simplifying, moving, or replacing a mechanism, identify:

- why it exists;
- which object owns it and its teardown;
- its inputs, outputs, and side effects;
- which user-visible/protocol behavior it protects;
- relevant tests, history, and official GNOME/GJS/MPRIS/D-Bus documentation;
- whether the replacement preserves the same invariant.

A mechanism may be replaced; its necessary behavior may not be lost accidentally.

## References

- [MPRIS specification](https://specifications.freedesktop.org/mpris/latest/)
- [D-Bus specification](https://dbus.freedesktop.org/doc/dbus-specification.html)
- [GJS guide](https://gjs.guide/)
- [GNOME Shell extension review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
- [GNOME Shell extension best practices](https://gjs.guide/extensions/review-guidelines/best-practices.html)
- [GNOME extension preferences](https://gjs.guide/extensions/development/preferences.html)
- [Gio API](https://docs.gtk.org/gio/)
