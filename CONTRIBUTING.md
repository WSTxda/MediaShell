# Contributing

Keep changes focused, work through the component that owns the behavior, and validate the contracts affected by the change.

Read [Architecture](docs/ARCHITECTURE.md) before changing ownership, process boundaries, lifecycle, or project structure. [Development](docs/DEVELOPMENT.md) is supplemental guidance for the toolchain, implementation conventions, compatibility work, validation, and live debugging when a change needs that depth.

## Workflow

```bash
pnpm install
pnpm run env:doctor
pnpm run check:runtime
pnpm check
pnpm build
```

Run `pnpm verify` for release, packaging, compatibility, or EGO-facing changes. The generated extension under `dist/builds/` must be installed and tested in GNOME before release or submission.

## Change rules

- Respect the boundaries between `src/shared/`, `src/shell/`, and `src/prefs/`.
- Extend the existing owner when its responsibility already matches the change; avoid parallel implementations of the same contract.
- Preserve persisted and external contracts unless a compatibility change is intentional.
- Keep resource creation and cleanup under the same owner.
- Update tests, declarative resources, strings/translations, comments, and documentation when their actual contract changes.
- Prefer precise ownership and narrow interfaces over broad abstractions.
- Share code only when behavior, side effects, ownership, lifecycle, teardown, and expected evolution are genuinely the same.
- Test observable behavior and stable contracts; validators must not enforce incidental source layout or style by heuristic.
- Keep unrelated cleanup out of functional commits unless it is required to complete the change safely.

## Translations

The translation template is:

```text
assets/locale/mediashell@wstxda.github.com.pot
```

After changing user-visible translatable text, update the source template and locale catalogs:

```bash
pnpm run translations
pnpm check
```

Keep the source string and every affected catalog aligned. Preserve reviewed translations, placeholders, plural forms, source references, translator comments, and valid catalog headers.

When the native toolchain is available, `pnpm check:native` verifies that the catalogs compile successfully with gettext.

## Commits

Keep commits reviewable and give each commit one coherent purpose. A functional change, generated translation update, test alignment, and broad documentation cleanup may be separate commits when that separation makes review or rollback safer.

Do not hide unrelated cleanup inside a feature or fix commit. If a prerequisite refactor is necessary, make its relationship to the functional change clear.

## Pull requests

Describe:

- the behavior or contract changed;
- the affected GNOME Shell, Preferences, or MPRIS scenario;
- the automated commands run;
- the live tests performed and GNOME versions used;
- relevant diagnostic information for lifecycle, D-Bus, identity, artwork, or private Shell API problems.

Documentation should capture stable architecture, contracts, constraints, and non-obvious decisions. Local widget behavior and other details expected to evolve should remain discoverable from the implementation rather than being duplicated as long-lived documentation.
