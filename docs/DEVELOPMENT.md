# Development

This document describes the MediaShell 3.0 development workflow and implementation conventions. Read [Architecture](ARCHITECTURE.md) before structural changes and [Contributing](../CONTRIBUTING.md) before submitting changes.

## Supported runtime

MediaShell currently targets:

- GNOME Shell 48–51;
- GTK4/Libadwaita Preferences (Libadwaita 1.7+);
- MPRIS2 players on the session D-Bus;
- Node.js 20.19+;
- pnpm 11.25.0 exactly for repository tooling.

Private GNOME Shell integrations are version-sensitive. A successful Node/tooling run does not replace live validation on supported Shell releases.

## Setup

Install the locked JavaScript dependencies and inspect the complete development toolchain:

```bash
pnpm install
pnpm env:doctor
```

The project pins pnpm through `packageManager`/`engines`. `pnpm-workspace.yaml` also enforces dependency-state and supply-chain policy: a strict package maturity window, trust downgrade protection, lockfile revalidation, blocked exotic transitive sources, deny-by-default dependency build scripts, strict peer resolution, and high-severity audit reporting.

Native validation uses the actual GLib/GIO/gettext tools (`glib-compile-schemas`, `glib-compile-resources`, `gdbus-codegen`, `xgettext`, `msgcmp`, and `msgfmt`). Package creation uses `gnome-extensions pack`, and release validation uses Shexli.

## Command hub

The public pnpm surface is intentionally small. Build primitives such as staging, copying, resource compilation, and packing are internal implementation details of `scripts/dev.mjs` and `scripts/dev/build.mjs`.

| Command                           | Purpose                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm check`                      | Fast deterministic development validation; no release package and no registry audit.           |
| `pnpm check:all`                  | Adds frozen dependency-state, registry security, and native GNOME/gettext validation.          |
| `pnpm check:package`              | Deeply validates the single current package in `dist/builds/`.                                 |
| `pnpm check:shexli`               | Runs Shexli JSON analysis on the single current package in `dist/builds/`.                     |
| `pnpm test`                       | Runs the behavior/contract test suite.                                                         |
| `pnpm lint`                       | Runs JavaScript parsing, module graph/boundary, GNOME API, and entrypoint checks.              |
| `pnpm format`                     | Rewrites supported repository files with Prettier.                                             |
| `pnpm build:debug`                | Checked local build that replaces the canonical package in `dist/builds/`.                     |
| `pnpm build:force`                | Unchecked package that replaces the canonical package in `dist/builds/`.                       |
| `pnpm build:release`              | Full EGO-oriented pipeline over the same canonical package; writes SHA-256 only after success. |
| `pnpm ext:install`                | Installs the current canonical package, regardless of which build profile produced it.         |
| `pnpm ext:remove`                 | Uninstalls MediaShell.                                                                         |
| `pnpm ext:enable` / `ext:disable` | Enables or disables MediaShell.                                                                |
| `pnpm ext:prefs`                  | Opens MediaShell Preferences.                                                                  |
| `pnpm ext:reinstall`              | Builds debug into the canonical package and installs it; it does not fake hot-enable.          |
| `pnpm ext:upload`                 | Rebuilds and validates release, then uploads only that release artifact to EGO.                |
| `pnpm env:doctor`                 | Validates the declared Node/pnpm/GNOME/gettext/Shexli development environment.                 |
| `pnpm shell:debug`                | Starts the supported GNOME Shell development session.                                          |
| `pnpm translations`               | Regenerates/merges catalogs transactionally and leaves already-current POT/PO files untouched. |

## Validation gates

The tooling deliberately stays below the project ceiling of twenty checks. It groups related facts into a small number of strong gates rather than adding one test for every symbol or implementation detail.

`pnpm check` validates:

1. JavaScript parsing, static relative imports, cycles, process boundaries, and the gateway into private Shell adapters;
2. stable GNOME runtime API and extension/preferences entrypoint contracts;
3. observable behavior and reusable domain contracts through `node:test`;
4. stable declarative contracts derived from metadata, GSettings, GtkBuilder, D-Bus, and shared playback descriptors;
5. parsed resource/image/XML integrity and repository formatting.

`pnpm check:all` additionally validates:

6. the frozen pnpm dependency state under the repository supply-chain policy;
7. high-severity advisories plus registry ECDSA signatures;
8. schemas and GResources through GLib, D-Bus introspection through `gdbus-codegen`, and translation extraction/template/catalogs through GNU gettext.

A release adds three artifact gates:

9. exact ZIP inventory, safe paths, metadata, packaged module targets, and byte-for-byte comparison with freshly compiled resources/catalogs;
10. logical reproducibility across two clean packages;
11. Shexli JSON analysis of the exact ZIP that will be promoted; deterministic `error` findings block, while reviewer-oriented warnings/manual-review findings are surfaced without pretending they are definitive failures.

These gates protect boundaries and externally meaningful behavior. Do not add checks for function names, class names, incidental call chains, arbitrary complexity/coverage thresholds, or source text patterns when a parser/native authority can prove the property instead.

## Build profiles

All profiles preserve the normal MediaShell icon, metadata, UUID, name, and version. There is no debug/force cosmetic mutation.

### Debug

```bash
pnpm build:debug
```

Runs the normal development checks, native compilation, creates a fresh package, and validates the resulting ZIP. Output: `dist/builds/mediashell@wstxda.github.com.shell-extension.zip`.

### Force

```bash
pnpm build:force
```

Copies the runtime and performs only operations intrinsically required to create a GNOME extension bundle (resource compilation and `gnome-extensions pack`). It replaces `dist/builds/mediashell@wstxda.github.com.shell-extension.zip` and removes any stale release SHA-256 sidecar. It intentionally skips source checks, tests, audits, package validation, reproducibility, and Shexli. A force build is never EGO-approved merely because it occupies the canonical package path.

### Release

```bash
pnpm build:release
```

The release path:

1. verifies the frozen dependency state and pnpm supply-chain policy;
2. runs all repository and native gates;
3. builds a fresh package and atomically replaces the canonical `dist/builds/mediashell@wstxda.github.com.shell-extension.zip`; replacing the ZIP also removes any stale SHA-256 sidecar;
4. validates that exact ZIP;
5. builds one temporary clean reproduction and compares every logical runtime file hash;
6. runs Shexli on the canonical ZIP, blocking deterministic `error` findings and surfacing reviewer-oriented findings;
7. writes the SHA-256 sidecar only after every release gate passes.

If a release fails after packaging, the canonical ZIP remains available for `pnpm check:package` and `pnpm check:shexli`, but no SHA-256 sidecar is written and `pnpm ext:upload` does not continue. The temporary reproduction is always removed.

### Current package and installation

There is exactly one persistent package artifact:

```text
dist/builds/mediashell@wstxda.github.com.shell-extension.zip
```

Build profile is pipeline state, not artifact identity. Each successful `build:debug`, `build:force`, or `build:release` replaces this ZIP. Commands that consume an existing package therefore need no selector:

```bash
pnpm check:package
pnpm check:shexli
pnpm ext:install
```

`pnpm ext:reinstall` remains the development loop: it runs `build:debug` and then installs the same canonical ZIP. To install a force or release build, run that build command first and then `pnpm ext:install`.

`gnome-extensions install` places the extension under the user extension directory for discovery by the **next Shell session**. A first installation therefore is not immediately enableable in the already-running Wayland Shell. `ext:reinstall` deliberately stops after installation instead of issuing a misleading immediate `enable`; start a fresh supported development Shell with `pnpm shell:debug`, or begin a new desktop session, then use `pnpm ext:enable`.

## Formatting and naming

The project uses Prettier as its repository formatter:

```bash
pnpm format
pnpm check
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
src/shell/private/gnome/nativecontrols/compatibility.js
```

PanelMenu private click-gesture compatibility belongs under:

```text
src/shell/private/gnome/panelmenu/
```

The MediaShell core must not adapt itself to a private Shell implementation. The private adapter receives MediaShell capabilities and translates them to the current Shell version. Unsupported private structures must fail open and preserve native behavior.

When private APIs change, validate every supported GNOME release.

## Translations

JavaScript UI strings use the project gettext helpers. GtkBuilder strings use `translatable="yes"`.

After changing visible strings:

```bash
pnpm translations
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
4. Run `pnpm build:release` with the complete native toolchain.
5. Install the freshly generated archive, not a stale package.
6. Run the relevant live GNOME matrix.
7. Inspect journal output for leaks/fallback loops/errors.
8. Re-check a clean `git status` before tagging/publishing.
