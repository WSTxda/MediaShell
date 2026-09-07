# Contributing

This file defines the contribution rules for MediaShell. Read [Architecture](docs/ARCHITECTURE.md) for ownership and process boundaries and [Development](docs/DEVELOPMENT.md) for the development workflow.

## Before editing

Find the component that already owns the behavior and trace its callers, lifecycle, settings, protocol data, and user-facing contracts before changing it. Extend the existing path when its responsibility matches; do not create parallel MPRIS, artwork, settings, playback, rendering, or lifecycle implementations for local convenience.

For structural, cross-surface, settings, asynchronous, or private-API changes, prepare a small integration map covering the current owner, the intended integration point, affected contracts, cleanup/stale-result risks, and the validation needed.

Do not remove or replace unfamiliar safeguards until their purpose is understood. Internal moves and renames should update callers atomically rather than leaving aliases or transitional implementations without a compatibility requirement.

## Change requirements

- Preserve the `shared` / `shell` / `prefs` process boundaries described by the architecture.
- Preserve persisted and external contracts unless the change intentionally includes migration or compatibility work.
- Keep resource creation, asynchronous work, signal connections, and cleanup under the same owner.
- Reject late results when the MPRIS endpoint, component, window, or extension lifecycle that requested them is no longer current.
- Share implementation only when ownership, side effects, teardown, and expected evolution are genuinely shared.
- Keep MPRIS/D-Bus semantics at the protocol boundary and keep private GNOME Shell access behind its integration boundary.
- Keep functional changes and unrelated cleanup separate.
- Update documentation only when a durable boundary, supported workflow, contributor obligation, or externally meaningful contract changes.

## Validation

Install the locked dependencies and run the development gate:

```bash
pnpm install
pnpm check
```

Run `pnpm build:debug` when runtime source, schemas, resources, translations, or packaging are affected. Release candidates use `pnpm build:release`.

Automated checks do not replace live GNOME testing. Exercise the changed behavior on the relevant supported Shell versions and real MPRIS endpoints, especially for UI lifecycle or private Shell API changes.

## Translations

User-visible JavaScript and GtkBuilder strings must use the project gettext path. After changing translatable text:

```bash
pnpm translations
pnpm check
```

Review the resulting catalogs and preserve existing translations, plural forms, placeholders, source references, and translator comments.

## Commits and pull requests

Keep commits coherent and reviewable. A pull request should explain what changed, why it belongs at that integration point, compatibility implications, automated checks run, and relevant live scenarios tested.

Do not include generated noise or diagnostic output that is unrelated to the change.
