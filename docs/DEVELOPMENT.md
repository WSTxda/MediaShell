# Development

## Toolchain

Use the Node.js and pnpm versions declared in `package.json`. GNOME development requires GJS, GNOME Shell, `gnome-extensions`, GNU gettext, and GLib resource/schema tools. Release verification also requires `shexli`.

```bash
pnpm install
pnpm run env:doctor
pnpm run shell:debug
```

## Commands

| Command                  | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `pnpm run check:runtime` | Validate source, parsed contracts, tests, assets, translations, and script syntax. |
| `pnpm check`             | Run runtime checks, formatting verification, and the organization audit.           |
| `pnpm run audit`         | Report naming, ownership, logger-scope, and source-layout drift.                   |
| `pnpm run audit:strict`  | Treat the organization audit as a cleanup gate.                                    |
| `pnpm check:native`      | Run validation with native GLib and gettext tools.                                 |
| `pnpm build`             | Validate, compile resources, package, and inspect the archive.                     |
| `pnpm verify`            | Build and run `shexli` against the final package.                                  |

Runtime checks cover imports, unresolved identifiers, process boundaries, lifecycle patterns, metadata, settings, GtkBuilder, D-Bus XML, assets, translations, tests, and package contents.

Semantic JavaScript checks must use the existing parser, AST, and scope analysis. Regex-only checks are not accepted for language semantics.

Keep the Node suite at no more than 20 top-level `test()` cases. Strengthen an existing behavioral or contract test before adding a narrow new one.

## Working on a change

Start with the component that owns the behavior; see [Architecture](ARCHITECTURE.md). Extend an existing service, renderer, controller, executor, or lifecycle owner when its responsibility already matches the change.

Keep these boundaries intact:

- `src/shared/` contains toolkit-independent contracts and helpers;
- `src/shell/` contains the GNOME Shell runtime and St/Clutter UI;
- `src/prefs/` contains the GTK4/Libadwaita Preferences runtime;
- Shell and Preferences communicate through shared contracts and GSettings.

The creator of a signal, GLib source, cancellable, asynchronous generation, actor, or private API override owns its cleanup.

Use PascalCase filenames when the primary export is an owning class with the same name. Use camelCase for functional modules, policies, enums, declarative tables, and pure helpers. Constant modules contain values and frozen data; transformation and decision logic belongs in utilities.

Use lifecycle verbs according to behavior:

- `create*` always creates;
- `ensure*` creates only when absent;
- `build*` composes and returns a value;
- `resolve*` derives a decision;
- `sync*` updates existing state;
- `reconcile*` creates, updates, or removes toward a target state;
- `schedule*` owns deferred work;
- `attach*` places an existing actor;
- `remove*` leaves an owner reusable;
- `destroy*` performs final teardown.

Share implementation only after confirming identical inputs, outputs, side effects, ownership, lifecycle, teardown, and expected evolution. Do not rename or merge modules only to make parallel code look identical.

### Naming vocabulary

- Use `MediaApp` for the runtime entity discovered, selected, displayed, and controlled by MediaShell.
- Use `Player` only for documented technical contracts such as `org.mpris.MediaPlayer2.Player`, its proxy, properties, methods, and signals.
- Use `desktopApp` or `shellApp` for `Gio.AppInfo`, `Shell.App`, and desktop-entry resolution when plain `app` would be ambiguous.
- Preserve compact interface labels such as `Open app`, `Quit app`, `Switch app`, `Apps`, and `App icon`.
- `Blocked apps` refers to the installed desktop applications listed by Preferences and must not be renamed to Blocked media apps.

## Compatibility

Preserve shipped settings, enum values, D-Bus names, resource paths, GtkBuilder IDs, CSS classes, `GTypeName` strings, playback-control IDs, and other persisted or external contracts unless a compatibility change is intentional and documented.

## Common change paths

### Settings

A setting change may involve:

- the GSettings schema;
- JavaScript key/spec definitions;
- Shell behavior;
- a Preferences binding or controller;
- visible strings and translations;
- tests and documentation.

Keep these representations aligned and preserve persisted values unless migration is part of the change.

### MPRIS and D-Bus

Route playback actions through the existing control definitions, state decisions, executor, and `MprisMediaApp`. UI state must follow capabilities and properties confirmed by the endpoint.

Normalize untrusted metadata before display. Keep desktop, browser, and PWA identity resolution generic and evidence-based rather than adding media-app-specific behavior.

### Artwork and asynchronous work

Preserve ownership, cancellation, generation checks, active-endpoint checks, stream closure, cache recovery, and resource limits. Late results from an old endpoint or lifecycle generation must not mutate current state.

### Translations

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

### Comments and logs

Document intent where it is not obvious, especially around lifecycle, asynchronous invalidation, signal ownership, MPRIS/D-Bus edge cases, compatibility, and private Shell APIs.

Logs should report failures or meaningful state transitions, not normal rendering or successful cleanup. Logger scopes follow the owning class or classless module.

## Live testing

Automated checks cannot prove GNOME actor lifetime, private Shell API compatibility, or the behavior of real MPRIS implementations. Test the scenarios affected by the change.

Runtime and lifecycle changes commonly require:

- enable, disable, reload, and repeated popup opening;
- native and browser-backed MPRIS sessions;
- multiple endpoints, selection, pinning, owner replacement, and grace periods;
- supported and unsupported MPRIS capabilities;
- affected top bar, popup, Preferences, artwork, and input paths;
- local, remote, cached, cancelled, and failed artwork requests;
- the GNOME media-controls patch when changed.

Use Shell logs when needed:

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell
```

Record the GNOME release, media app, MPRIS bus name, relevant settings, reproduction steps, and the smallest useful log excerpt.

## Release

From a clean tree:

```bash
pnpm check
pnpm build
pnpm verify
```

The generated package is under `dist/builds/`. Install it, run the relevant live tests, and publish only the validated `.shell-extension.zip`.

## References

- [MPRIS Player interface](https://specifications.freedesktop.org/mpris/latest/Player_Interface.html)
- [GNOME Shell extension development](https://gjs.guide/extensions/)
- [Preferences and GSettings](https://gjs.guide/extensions/development/preferences.html)
- [GNOME extension review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
