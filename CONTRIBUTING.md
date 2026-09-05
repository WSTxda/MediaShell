# Contributing

This document defines the requirements for contributing to MediaShell. Read [Architecture](docs/ARCHITECTURE.md) for ownership/process boundaries and [Development](docs/DEVELOPMENT.md) for toolchain, naming, validation, translations, and live debugging.

## Before editing

Identify the component that already owns the behavior, its callers, and every persisted or external contract affected by the change. Extend that path when its responsibility matches; do not create a parallel MPRIS implementation, artwork loader/cache, playback executor, settings path, renderer, or lifecycle owner for local convenience.

For architectural, structural, naming, cross-surface, settings, asynchronous, or private-API work, build an integration map covering:

- existing owners and call paths studied;
- authoritative integration point and code to reuse;
- files/symbols to add, move, rename, replace, or remove;
- process-boundary and dependency-direction effects;
- lifecycle/cancellation/stale-result risks;
- persisted/protocol/private-platform contracts involved;
- deterministic checks and live GNOME scenarios required.

Internal moves and renames must update call sites atomically. Do not leave aliases, compatibility wrappers, duplicate implementations, or transitional directories without a real compatibility requirement.

## Behavior-preservation rule

**Never remove, simplify, relocate, or replace behavior until its purpose, owner, lifecycle, protocol implications, and existing safeguards are understood. A refactor may replace the mechanism; it must not accidentally discard the behavior.**

Before deleting or replacing a suspicious timer, grace period, retry, cache, generation, fallback, signal, capability check, or workaround, determine what scenario it protects and check relevant tests, history, architecture, and official GNOME/GJS/MPRIS/D-Bus documentation.

Examples of invariants that require deliberate treatment include MPRIS owner handoff, empty-metadata/browser grace, initial polling, stale asynchronous rejection, Position projection, `Seeked`, TrackId-safe `SetPosition`, artwork cancellation/cache bounds, incremental surface updates, Popup deferred rendering, session-mode generation guards, private Shell fallback, and complete teardown.

If current behavior is demonstrably wrong relative to the protocol/platform, change it deliberately and document the reason instead of silently losing it during cleanup.

## Change requirements

- Keep `src/shared/`, `src/shell/`, and `src/prefs/` within the dependency boundaries documented in the architecture.
- Keep D-Bus/MPRIS as endpoint lifecycle authority; DesktopApp/PWA resolution is presentation identity.
- Route reusable Shell media behavior through the existing MediaRuntime capabilities instead of adding surface-local protocol/services.
- Keep private GNOME Shell contracts inside the private compatibility/adaptation tree. Core MediaShell code must not depend on private implementation details.
- Keep resource creation, signal connections, GLib sources, cancellables, asynchronous generations, actor ownership, sessions, and cleanup under the same owner.
- Reject results produced for a replaced owner, track, request, actor, window, profile, or extension lifecycle.
- Preserve GSettings keys/values, D-Bus contracts, resource paths, GtkBuilder IDs, CSS classes, `GTypeName`s, action IDs, and other persisted/external contracts unless the change intentionally includes the required migration/break.
- Share implementation only when inputs, outputs, side effects, ownership, teardown, and expected evolution are genuinely the same. Similar Popup and Top Bar code is not sufficient reason for inheritance or a generic surface.
- Put constants/helpers with the domain that owns their meaning. Do not introduce catch-all `constants`, `utils`, or `services` directories for convenience.
- Update tests, declarative resources, translations, comments, and documentation when the behavior/contract they represent changes.
- Test observable behavior and stable contracts; avoid source-shape tests that merely duplicate implementation details.
- Keep functional changes and unrelated cleanup separate when doing so improves review and rollback.

## Vocabulary

Use the canonical terms consistently:

- **MprisPlayer**: one owned `org.mpris.MediaPlayer2.*` endpoint;
- **Track**: normalized MPRIS Metadata snapshot;
- **MediaRuntime**: Shell media capability composition;
- **DesktopApp** / **Shell.App**: GNOME application identity, distinct from an MPRIS endpoint;
- **Artwork**: technical MediaShell artwork acquisition/cache/presentation vocabulary; protocol/user-facing “album art” remains valid where appropriate;
- **Surface**: independent presentation root such as Popup or Top Bar;
- **Private adapter**: GNOME Shell-version-specific implementation consuming MediaShell capabilities.

Protocol names keep the spelling defined by MPRIS/D-Bus at the protocol boundary.

## Translations

JavaScript strings shown to users use the project gettext helpers. GtkBuilder strings use `translatable="yes"`. Identifiers, protocol values, settings keys, and other code contracts are not translated.

After changing translatable text:

```bash
pnpm run translations
pnpm check
```

Review the resulting `.pot` and `.po` changes. Preserve reviewed translations, placeholders, plural forms, source references, translator comments, and valid headers.

## Validation

Install the locked dependencies and run:

```bash
pnpm install
pnpm check
```

Use `pnpm build:debug` when runtime source, schemas, resources, translations, packaging, or platform compatibility change. Use `pnpm build:release` for a release candidate or EGO submission; it is the only build profile considered publishable. `pnpm build:force` deliberately skips validation and is only a packaging escape hatch for local investigation.

The generated extension must still be installed and exercised in GNOME. Automated checks cannot prove Shell actor behavior, private API compatibility, visual output, or the quirks of real MPRIS endpoints.

For live testing, record the GNOME version and, when relevant, player/browser, settings, reproduction steps, and useful journal output.

## Commits and pull requests

Keep commits coherent and reviewable. A pull request should state:

- behavior or contract changed and why;
- affected Shell, Preferences, MPRIS, settings, private integration, or package path;
- compatibility/migration consequences;
- automated commands run;
- live scenarios and GNOME versions tested.

Include only diagnostics that help reproduce or explain a failure.

## Documentation changes

Update documentation when ownership, process boundaries, stable contracts, contributor obligations, supported workflows, or non-obvious compatibility constraints change. Avoid duplicating transient widget dimensions, animation internals, or other implementation details already obvious from source and likely to evolve.
