# Contributing

Keep changes focused, work with the component that owns the behavior, and test the affected GNOME Shell, Preferences, and MPRIS paths.

Read [Architecture](docs/ARCHITECTURE.md) before changing ownership or project structure. See [Development](docs/DEVELOPMENT.md) for the toolchain, implementation conventions, validation, and live-testing guidance.

## Workflow

```bash
pnpm install
pnpm run env:doctor
pnpm run check:runtime
pnpm check
pnpm build
```

Run `pnpm verify` for release, packaging, compatibility, or EGO-facing changes. The generated package is under `dist/builds/` and must be installed and tested in GNOME before submission.

## Change rules

- Respect the boundaries between `src/shared/`, `src/shell/`, and `src/prefs/`.
- Extend the existing owner when it already matches the responsibility.
- Preserve persisted and external contracts unless a compatibility change is intentional and documented.
- Keep cleanup related to the change being made.
- Update affected tests, strings, translations, comments, logs, and documentation.
- Prefer precise names and explicit ownership over broad abstractions.
- Share code only when its contract, side effects, ownership, lifecycle, teardown, and expected evolution are truly identical.
- Test observable behavior and stable contracts; do not enforce incidental source layout through validators.

## Translations

The translation template is:

```text
assets/locale/mediashell@wstxda.github.com.pot
```

After changing user-visible text, run:

```bash
pnpm run translations
pnpm check
```

Preserve reviewed translations, placeholders, plural forms, source references, translator comments, and valid catalog headers.

## Pull requests

Describe:

- the behavior or contract changed;
- the affected GNOME Shell or MPRIS scenario;
- the automated commands run;
- the live tests performed and GNOME versions used;
- relevant logs for lifecycle, D-Bus, identity, artwork, or private Shell API problems.

Keep commits reviewable and do not mix unrelated cleanup with functional changes.
