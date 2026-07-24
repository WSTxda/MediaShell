# Contributing

Thanks for helping improve MediaShell. Keep changes focused, work in the layer that owns the behavior, and test the affected GNOME Shell, Preferences, and MPRIS paths.

## Workflow

```bash
pnpm install
pnpm run env:doctor
pnpm run shell:debug
pnpm check
pnpm build
```

Use `pnpm run check:runtime` for the executable/declarative validation tier and `pnpm run audit` for advisory organization diagnostics. `pnpm run audit:strict` is only for cleanup work that intentionally treats those conventions as a gate.

For release, packaging, compatibility, or EGO-facing changes, also run:

```bash
pnpm verify
```

The generated extension package is under `dist/builds/` and must be installed and tested in GNOME before submission.

## Change scope

- Keep `src/shared/`, `src/shell/`, and `src/prefs/` within their documented process boundaries.
- Preserve shipped GSettings keys, enum IDs, D-Bus names, resource paths, CSS class values, and `GTypeName` strings unless the change includes an explicit compatibility plan.
- Prefer a small truthful local implementation over aliases, generic abstraction, or a new constants module for a one-off detail.
- Update module headers, comments, documentation, and logs only when ownership or behavior actually changes.
- Do not add permanent check rules for temporary cleanup vocabulary or formatting preferences.

See [Architecture](docs/ARCHITECTURE.md) for ownership and [Development](docs/DEVELOPMENT.md) for naming, validation, and live-test guidance.

## Pull requests

Describe:

- the behavior or contract changed;
- the affected GNOME Shell/MPRIS scenario;
- automated commands run;
- live tests performed and GNOME versions used;
- relevant logs for lifecycle, D-Bus, private API, or identity-resolution problems.

Keep commits reviewable and avoid mixing unrelated cleanup with functional changes.

## Translations

The template is `assets/locale/mediashell@wstxda.github.com.pot`. Use a gettext-aware editor and, after changing visible text, run:

```bash
pnpm run translations
pnpm check
```

Preserve placeholders, plural forms, source references, and translator comments. Do not invent translator names or addresses. Leave a translation empty when it needs native review rather than guessing.

JavaScript visible strings use gettext helpers. GtkBuilder strings use `translatable="yes"`. Code contracts are not translatable.
