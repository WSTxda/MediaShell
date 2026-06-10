# Development

## Environment

Use the Node.js and pnpm versions declared by `package.json`. The native toolchain requires GJS, GNU gettext, GLib resource and schema tools, GNOME Shell, and `gnome-extensions`.

Run:

```bash
pnpm doctor
pnpm check
pnpm build
```

The repository has no JavaScript runtime dependencies. pnpm only routes project commands.

## Source layout

- `src/shell/`: GNOME Shell runtime.
- `src/prefs/`: GTK and Libadwaita Preferences.
- `src/shared/`: toolkit-independent contracts and helpers.
- `assets/ui/`: GtkBuilder definitions.
- `assets/dbus/`: MPRIS introspection XML.
- `assets/locale/`: gettext template and catalogs.
- `tests/`: Node.js unit tests for shared behavior.
- `scripts/`: validation and development commands.

## Development session

```bash
pnpm debug
```

The launcher chooses the supported nested or devkit session for the installed GNOME Shell release.

Extension commands:

```bash
pnpm run ext:install
pnpm run ext:enable
pnpm run ext:disable
pnpm run ext:prefs
pnpm run ext:uninstall
```

## Change rules

- Keep Shell, Preferences, and shared imports inside their process boundaries.
- Give every signal, source, cancellable, proxy, actor, and cache a clear owner.
- Prefer event-driven updates, coalescing, actor reuse, and bounded recovery.
- Keep D-Bus ownership authoritative for media app lifecycle.
- Use the canonical UI names documented in `docs/UI_CONTRACT.md`.
- Update code, tests, translations, and documentation in the same change.

## Adding a setting

1. Add the key or enum to the schema.
2. Add runtime mapping to `SettingsSpec` when used by the Shell process.
3. Add a declarative binding or custom Preferences controller.
4. Define validation bounds or normalization where required.
5. Add migration behavior only when persisted compatibility requires it.
6. Update translations, tests, and `docs/SETTINGS.md`.

## Translations

```bash
pnpm run translations
```

Visible UI strings use gettext. Preserve placeholders, plural forms, capitalization, and the canonical names used by Preferences.

## Debugging

Start with `pnpm doctor`, reproduce from a packaged build, and inspect a narrow log window:

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell
```

Record the GNOME Shell release, media app, MPRIS bus name, relevant settings, reproduction steps, and focused logs.
