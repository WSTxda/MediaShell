# Development

This document describes the MediaShell 3.0 development workflow and implementation conventions. Read [Architecture](ARCHITECTURE.md) before structural changes and [Contributing](../CONTRIBUTING.md) before submitting changes.

## Supported runtime

MediaShell currently targets:

- GNOME Shell 48–51;
- GTK4/Libadwaita Preferences (Libadwaita 1.7+);
- MPRIS2 players on the session D-Bus;
- Node.js 20+ and pnpm for repository validation/tooling.

Private GNOME Shell integrations are version-sensitive. A successful Node/tooling run does not replace live validation on supported Shell releases.

## Setup

Install the locked JavaScript dependencies and inspect the native toolchain:

```bash
pnpm install
pnpm run env:doctor
```

The native build/release path expects GNOME/gettext tools such as `glib-compile-schemas`, `glib-compile-resources`, `gnome-extensions`, `xgettext`, and `msgfmt`.

## Validation commands

### Source and behavior

```bash
pnpm check
```

`pnpm check` runs the normal development gate:

1. JavaScript syntax/import/boundary checks;
2. behavior tests;
3. declarative schema/UI/D-Bus/playback contracts;
4. resource and translation consistency;
5. repository formatting check.

For runtime gates without the formatter:

```bash
pnpm run check:runtime
```

### Native validation

```bash
pnpm run check:native
```

This validates schemas, resources, and gettext with the native toolchain.

### Package

```bash
pnpm run build:package
pnpm run check:package
```

The extension archive is written under `dist/builds/`.

### Release candidate

```bash
pnpm verify
```

`verify` is the release gate: repository checks, native compilation, a fresh package, package validation, and `shexli` validation.

## Formatting and naming

The project uses Prettier as its repository formatter:

```bash
pnpm run format
pnpm run format:check
```

Naming follows GJS/GNOME conventions where they apply:

- JavaScript files: `lowerCamelCase.js`;
- directories: short lowercase names;
- classes/imported module values: `PascalCase`;
- JavaScript functions/properties: `lowerCamelCase`;
- GSettings keys: lower-kebab-case;
- MPRIS/D-Bus interface, method, signal, property, and metadata names: exactly the protocol spelling at the protocol boundary.

Prefer semantic names over role repetition. Common suffixes have specific intent:

| Suffix                          | Use                                                                 |
| ------------------------------- | ------------------------------------------------------------------- |
| `*Runtime`                      | Composition/facade for a coherent runtime domain.                   |
| `*Registry`                     | Owns the lifetime/selection of a collection of entities.            |
| `*Controller`                   | Coordinates behavior or commands across owned collaborators.        |
| `*Service`                      | Shared operation/I/O capability with a real runtime responsibility. |
| `*Resolver`                     | Resolves one representation/identity into another.                  |
| `*Adapter` / `*Integration`     | External or platform boundary.                                      |
| `*Surface` / surface root class | Independent UI root/lifecycle.                                      |

Method prefixes should make behavior easy to navigate:

- `normalize*`: normalize untrusted/external values;
- `resolve*`: compute/resolve without owning presentation lifecycle;
- `reconcile*`: bring current state toward desired state incrementally;
- `sync*`: update already-owned presentation/state;
- `ensure*`: lazy idempotent creation;
- `refresh*`: re-read authoritative external state;
- `handle*`: process a signal/event callback;
- `destroy*`: final teardown.

Do not create a `constants`, `utils`, or `services` bucket merely because a symbol fits that syntactic category. Put code with the domain that owns the concept. One-use constants stay with their owner; cross-process contracts belong in `shared`.

## Module headers and comments

Source modules keep their `@file`/`@module` header. A useful header explains the module's responsibility, important ownership, and protocol/platform constraints rather than restating the filename.

Internal comments are most valuable when they preserve a reason that future cleanup could accidentally remove, for example:

- browser empty-metadata grace;
- D-Bus owner handoff;
- stale asynchronous generation checks;
- MPRIS Position projection and `Seeked`;
- TrackId protection for `SetPosition`;
- consumer-aware artwork cancellation;
- Popup deferred reconciliation;
- GNOME-version private-API fallback.

Do not narrate obvious statements line by line.

## Logging

Create a scoped logger:

```js
const logger = createLogger("ComponentName");
```

Use the level that matches the problem:

- `debug` for actionable development diagnostics;
- `warn` for recoverable failures/fallbacks;
- `error` for failures that prevent the requested lifecycle or operation;
- `*Once` variants when a recurring failure would otherwise flood the journal.

Avoid per-frame, per-position, or routine-success logging.

Useful Shell logs:

```bash
pnpm run shell:debug
journalctl --user -f -o cat /usr/bin/gnome-shell
```

## Process-boundary rules

### Shared

`src/shared/` must remain toolkit-independent. It must not import Shell, GTK, Adwaita, St, Clutter, or other process-specific APIs.

Use it for actual shared contracts: settings names/defaults/bounds, input/control vocabulary, browser/PWA pure parsing, project/platform metadata, formatting, and logging primitives.

### Shell

Shell code must not import Preferences. MPRIS code must not import UI/private code. Normal core/UI code must not import the private GNOME tree directly; use the public integration boundary.

### Preferences

Preferences must not import Shell modules. Communicate through GSettings, resources, and shared contracts.

## MPRIS work

Start in `src/shell/mpris/` whenever the behavior is defined by the MPRIS/D-Bus endpoint itself.

Before changing player lifecycle, inspect:

- `clientPolicy.js`;
- `player.js`;
- `registry.js`;
- `metadata.js`;
- `position.js` and `positionTracker.js`;
- `selection.js`;
- relevant behavior tests.

Do not replace endpoint ownership with `Shell.App` heuristics. Do not make UI state authoritative over reported MPRIS capabilities.

When changing Metadata, keep raw protocol parsing at the MPRIS boundary and expose normalized Track fields to downstream media/UI code.

## Playback work

MPRIS supplies state/capabilities; `src/shell/media/playback/` supplies MediaShell control semantics. User actions should normally enter through `PlaybackController` instead of a surface directly invoking an MPRIS method.

If Popup and Top Bar need different controls or layout, keep their presentation independent while reusing the same control catalog/state/action semantics.

## Artwork work

`ArtworkService` owns acquisition and shared in-flight work. `ArtworkCache` owns persistent cache I/O and pruning. Surface artwork classes own actors, geometry, request generation, and cancellation.

Never add a second downloader/cache to a surface. Use the canonical Track and `createArtworkRequest()`.

## Settings and Preferences

The schema is the persisted source of truth. Update all participating representations atomically:

- `assets/org.gnome.shell.extensions.mediashell.gschema.xml`;
- `src/shared/settings/contract.js`;
- `src/shell/settings/settings.js` owner scope;
- Preferences bindings/controllers;
- GtkBuilder IDs/properties;
- tests/contracts;
- translation catalogs when visible text changes.

Do not reintroduce a global settings-to-widget impact table. The owner that consumes a setting owns the reaction to it.

A 3.x compatibility change to an existing key still requires deliberate migration/compatibility reasoning; do not silently repurpose persisted values.

## Incremental Shell UI

Popup and Top Bar have separate region masks and coalesced queues. Preserve these properties:

- MPRIS bursts reconcile once per idle turn;
- changes affect only dirty actors/regions;
- enabling/disabling one control does not rebuild unrelated actors;
- the closed Popup defers hidden rendering while retaining dirty regions;
- player handoff reuses current surface ownership where possible.

Do not solve a local update problem by rebuilding the entire indicator, Popup, or Top Bar unless the contract genuinely requires remounting (for example panel placement).

## Private GNOME Shell APIs

Private native controls fields and methods belong only in:

```text
src/shell/private/gnomeShell/nativeControls/compatibility.js
```

PanelMenu private click-gesture compatibility belongs under:

```text
src/shell/private/gnomeShell/panelMenu/
```

The MediaShell core must not adapt itself to a private Shell implementation. The private adapter receives MediaShell capabilities and translates them to the current Shell version. Unsupported private structures must fail open and preserve native behavior.

When private APIs change, validate every supported GNOME release.

## Translations

JavaScript UI strings use the project gettext helpers. GtkBuilder strings use `translatable="yes"`.

After changing visible strings:

```bash
pnpm run translations
pnpm check
```

Review `.pot` and every `.po` diff. Preserve existing translations, language/plural headers, placeholders, translator comments, and reviewed translations.

## Tests

Tests protect behavior and stable contracts, not incidental file layout.

High-value coverage includes:

- MPRIS normalization and operation semantics;
- player selection and owner replacement;
- playback controls/capabilities;
- position projection and seek behavior;
- artwork request/cache policy;
- settings/schema/UI/D-Bus contracts;
- process/private import boundaries;
- package integrity.

When reorganizing code, update a shape-dependent test only if it still protects a useful architectural boundary. Do not duplicate implementation detail merely to raise the test count.

## Live GNOME validation

Automated checks cannot validate Clutter/St geometry, private Shell actors, real bus ownership timing, or a player's bugs. Choose scenarios from the changed contract.

Minimum release-oriented scenarios include:

- enable/disable/reload repeatedly;
- GNOME 48, 49, 50, and 51 where available;
- Popup open/closed while tracks and players change;
- browser/Shorts/feed metadata transitions;
- owner handoff/player restart;
- seekable and non-seekable players;
- controls toggled live from Preferences;
- artwork cache on/off, local and remote artwork;
- native controls Hide/Enhance combinations, including both enabled together;
- lock/unlock Enhance where supported;
- reduced-motion enabled/disabled;
- extension disable while asynchronous artwork/MPRIS work is active.

## Release checklist

1. Start from a clean tree.
2. Update version metadata and visible release documentation.
3. Regenerate/merge translations if strings changed.
4. Run `pnpm verify` with the complete native toolchain.
5. Install the freshly generated archive, not a stale package.
6. Run the relevant live GNOME matrix.
7. Inspect journal output for leaks/fallback loops/errors.
8. Re-check a clean `git status` before tagging/publishing.
