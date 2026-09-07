# Development

[Architecture](ARCHITECTURE.md) defines ownership and process boundaries. [Contributing](../CONTRIBUTING.md) defines contribution requirements. This document covers the practical workflow for working on the current source tree.

## Environment

Use the Node.js and pnpm versions declared in `package.json`. GNOME development also requires the native tools used by the project for Shell, schemas/resources, translations, and packaging.

```bash
pnpm install
pnpm env:doctor
```

`env:doctor` checks the local development baseline, including the supported GNOME Shell range and Preferences requirements.

## Commands

`package.json` is the authoritative command inventory. The commands normally used directly are:

| Command              | Purpose                                                                            |
| -------------------- | ---------------------------------------------------------------------------------- |
| `pnpm test`          | Run behavioral and contract tests.                                                 |
| `pnpm lint`          | Validate JavaScript syntax, imports, boundaries, entrypoints, and runtime API use. |
| `pnpm check`         | Run the normal development gate, including tests and formatting.                   |
| `pnpm check:all`     | Add dependency and native validation to the development gate.                      |
| `pnpm format`        | Format maintained files with Prettier.                                             |
| `pnpm build:debug`   | Validate and build a development package.                                          |
| `pnpm build:force`   | Package without the normal validation gates.                                       |
| `pnpm build:release` | Run release validation and build the release package.                              |
| `pnpm ext:install`   | Install the current package.                                                       |
| `pnpm ext:reinstall` | Build the debug profile and reinstall it.                                          |
| `pnpm ext:prefs`     | Open the installed Preferences window.                                             |
| `pnpm shell:debug`   | Start the supported nested Shell development session.                              |
| `pnpm translations`  | Update translation catalogs after source-string changes.                           |

Build profiles write the canonical package under `dist/builds/`. `build:debug`, `build:force`, and `build:release` also accept `--install` when building and installing should be one operation.

## Source conventions

- JavaScript files use lower camel case; classes and imported class/module values use PascalCase.
- Keep code with the domain that owns it. Do not introduce generic `utils`, `services`, or `constants` buckets when ownership is more specific.
- `src/shared/` remains toolkit-independent; Shell and Preferences remain separate processes.
- The creator of a signal, timeout, cancellable, cache, actor, or private override owns its cleanup.
- Prefer asynchronous APIs for I/O and D-Bus operations that can block the Shell main loop.
- Reject stale asynchronous results after owner, endpoint, actor, or lifecycle replacement.
- Preserve protocol spelling at MPRIS/D-Bus boundaries and normalize external values before downstream use.
- Keep Popup and Top Bar presentation independent unless the full ownership and teardown contract is genuinely shared.
- Comments should explain non-obvious protocol, lifecycle, compatibility, or ownership reasons rather than narrating code.

## Working in core areas

### MPRIS and playback

Start in `src/shell/mpris/` when behavior belongs to the MPRIS endpoint or D-Bus protocol. MediaShell control semantics live under `src/shell/media/playback/`. Surfaces consume these capabilities instead of calling proxies directly.

### Identity and application actions

Desktop identity is presentation/action context, not MPRIS endpoint lifetime. Browser/PWA handling must be based on structural identity evidence and remain conservative when the endpoint cannot be mapped safely.

### Artwork

Use the shared artwork service/cache for acquisition. Surface components own only their actors, geometry, request generation, and presentation lifecycle.

### Settings and Preferences

Trace a setting through the schema, shared definitions, Shell consumers, Preferences bindings/controllers, GtkBuilder resources, translations, and tests that actually represent it. Opening Preferences must not mutate settings except through an explicit migration or user action.

### Private Shell APIs

Keep private GNOME Shell access behind the existing integration/private boundary. Private changes require capability checks, reversible lifecycle handling, and live testing on every supported Shell version they affect.

## Validation

For normal work:

```bash
pnpm check
```

For runtime, resource, schema, translation, or packaging changes:

```bash
pnpm build:debug
```

For a release candidate:

```bash
pnpm build:release
```

Automated gates verify source/package contracts but cannot prove visual correctness, real MPRIS behavior, Shell actor lifecycle, performance, or compatibility with private GNOME Shell internals. Test those paths live.

Useful diagnostics:

```bash
pnpm shell:debug
journalctl --user -f -o cat /usr/bin/gnome-shell
dconf watch /org/gnome/shell/extensions/mediashell/
```

## Translations

After changing user-visible strings:

```bash
pnpm translations
pnpm check
```

Review the `.pot` and `.po` changes rather than replacing existing reviewed translations with placeholders.

## References

- [MPRIS specification](https://specifications.freedesktop.org/mpris/latest/)
- [GNOME Shell extension development](https://gjs.guide/extensions/)
- [GNOME extension preferences](https://gjs.guide/extensions/development/preferences.html)
- [`Gio.Settings` API](https://docs.gtk.org/gio/class.Settings.html)
- [GNOME extension review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
- [GNOME extension best practices](https://gjs.guide/extensions/review-guidelines/best-practices.html)
