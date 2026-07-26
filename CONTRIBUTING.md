# Contributing

Thanks for helping improve MediaShell. Keep changes focused, work with the component that already owns the behavior, and test the affected GNOME Shell, Preferences, and MPRIS paths.

## Workflow

```bash
pnpm install
pnpm run env:doctor
pnpm run shell:debug
pnpm check
pnpm build
```

Use `pnpm run check:runtime` while developing and `pnpm run audit` when reviewing project organization. For release, packaging, compatibility, or EGO-facing changes, also run:

```bash
pnpm verify
```

The generated package is under `dist/builds/` and should be installed and tested in GNOME before submission.

## Change scope

- Respect the boundaries between `src/shared/`, `src/shell/`, and `src/prefs/`.
- Integrate changes with the existing service, renderer, controller, or lifecycle owner whenever possible.
- Preserve shipped settings, enum values, D-Bus names, resource paths, CSS classes, and `GTypeName` strings unless a compatibility change is intentional and documented.
- Keep cleanup related to the change being made, and update nearby comments, logs, translations, and documentation when their meaning changes.

See [Architecture](docs/ARCHITECTURE.md) for ownership and [Development](docs/DEVELOPMENT.md) for validation, conventions, and live testing.

## Pull requests

Describe:

- the behavior or contract changed;
- the affected GNOME Shell or MPRIS scenario;
- the automated commands run;
- the live tests performed and GNOME versions used;
- relevant logs for lifecycle, D-Bus, identity, or private Shell API problems.

Keep commits reviewable and avoid mixing unrelated cleanup with functional changes.

## Translations

The template is `assets/locale/mediashell@wstxda.github.com.pot`. After changing visible text, run:

```bash
pnpm run translations
pnpm check
```

Preserve placeholders, plural forms, source references, translator comments, and reviewed translations. JavaScript strings use gettext helpers, while GtkBuilder strings use `translatable="yes"`.
