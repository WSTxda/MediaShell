# Contributing

Thanks for helping improve MediaShell. Keep changes focused, test the affected Shell and Preferences paths, and update translations or documentation only when user-visible behavior, strings, architecture, or contributor workflow changes.

## Workflow

1. Install the declared development dependencies:

```bash
pnpm install
```

2. Check the local GNOME development environment:

```bash
pnpm doctor
```

3. Start a live development session:

```bash
pnpm debug
```

4. Make a focused change. Prefer small, reviewable commits over broad cleanup.
5. Run the maintained validation suite:

```bash
pnpm check
```

6. Build the extension package before opening a pull request:

```bash
pnpm build
```

`pnpm build` validates source, stages the runtime tree, compiles resources, creates the `.shell-extension.zip`, and validates the archive contents. For release or EGO-facing changes, install `shexli` and run:

```bash
pnpm verify
```

## Pull requests

Describe the behavior changed, the affected GNOME Shell or MPRIS scenario, and the live checks performed. Include focused logs when lifecycle, D-Bus, private Shell API, or media-app resolution failures are relevant.

Follow the process boundaries in [Architecture](docs/ARCHITECTURE.md) and the validation guidance in [Development](docs/DEVELOPMENT.md). For packaging or compatibility changes, include the `pnpm check`, `pnpm build`, `pnpm verify`, and packaged live-test results in the pull request notes.

## Translations

The translation template lives at `assets/locale/mediashell@wstxda.github.com.pot`. Translate it with Gtranslator, Poedit, or another gettext-aware editor and submit the updated `.po` file.

When a visible string changes:

```bash
pnpm run translations
pnpm check
```

Preserve placeholders, plural forms, source references, and translator comments. Do not remove an existing translation unless the English source text changed meaning and the old translation is no longer correct. If a new string cannot be translated confidently, leave `msgstr ""` so a native speaker can review it.

JavaScript strings must use gettext helpers. GtkBuilder strings must use `translatable="yes"`. Avoid changing GSettings key names, enum IDs, GTypeName strings, CSS classes, or D-Bus names for translation purposes; those are code contracts.

## Scope and review notes

- Keep Shell runtime, Preferences, and Shared changes in their owning layers.
- Use project vocabulary consistently: Panel, Top Bar, Popup, app selector, track information, playback controls, Progress Bar, visualizer, and media app.
- Use `player` only for MPRIS Player details, `PlayerProxy`, or protocol names.
- Keep the compact `@file` / `@module` header accurate when creating or moving JavaScript modules.
- Add inline comments when they explain lifecycle, signal ownership, teardown, MPRIS edge cases, compatibility, or non-obvious UI behavior.
- Keep logs useful for diagnosis; do not add noisy render-flow narration.
