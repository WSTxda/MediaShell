# Development

## Toolchain

Use the Node.js and pnpm versions declared in `package.json`. GNOME development requires GJS, GNOME Shell, `gnome-extensions`, GNU gettext, and GLib resource/schema tools. Release verification also requires `shexli`.

```bash
pnpm install
pnpm run env:doctor
pnpm run shell:debug
```

## Commands

| Command                  | Purpose                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| `pnpm run test`          | Run toolkit-independent behavior and contract tests.                     |
| `pnpm run check:runtime` | Validate source, tests, declarative contracts, assets, and translations. |
| `pnpm check`             | Run runtime validation and Prettier verification.                        |
| `pnpm check:native`      | Compile schemas, resources, and translations with the native toolchain.  |
| `pnpm build`             | Validate, compile resources, package, and inspect the generated archive. |
| `pnpm verify`            | Build and run `shexli` against the final package.                        |

`check:runtime` has four release-oriented gates:

1. parse JavaScript and validate imports, exports, cycles, process boundaries, entry points, and stable removed APIs;
2. run behavior and contract tests;
3. compare metadata, GSettings, GtkBuilder, playback tables, and D-Bus XML;
4. validate resources, translation catalogs, and development-script syntax.

The validators deliberately do not infer ownership, teardown, naming quality, dead code, or architectural intent from source shape. Those concerns require code review, behavior tests, and live GNOME testing. AST checks are kept only where syntax nodes provide an exact answer, such as static imports or use of a removed API.

## Working on a change

Start with the component that owns the behavior; see [Architecture](ARCHITECTURE.md). Extend an existing service, renderer, controller, executor, or lifecycle owner when its responsibility already matches the change.

Keep these boundaries intact:

- `src/shared/` contains toolkit-independent contracts and helpers;
- `src/shell/` contains the GNOME Shell runtime and St/Clutter UI;
- `src/prefs/` contains the GTK4/Libadwaita Preferences runtime;
- Shell and Preferences communicate through shared contracts and GSettings.

The creator of a signal, GLib source, cancellable, asynchronous generation, actor, or private API override owns its cleanup.

Use PascalCase filenames when the primary export is an owning class with the same name. Use camelCase for functional modules, policies, enums, declarative tables, and pure helpers.

Constant modules contain only pure values and frozen declarative data. Do not move live `GObject` instances, toolkit objects, or one-use trivial literals into shared constants. Reusable normalization, comparison, and decision logic belongs in utilities.

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

Do not write settings while enabling the extension or constructing Preferences. Native bindings and synchronization callbacks must not turn initial widget state into a write. Persist changes only after an explicit user interaction.

`PopupLayoutController` is a deliberate user-feedback path: after the user enables a popup seek control, it raises `popup-width` to the same minimum used by runtime layout. It performs no write during Preferences initialization and coalesces same-turn changes so bulk resets are evaluated from their final state.

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

Preserve reviewed translations, placeholders, plural forms, translator comments, and valid catalog headers. Runtime checks allow missing, empty, fuzzy, or obsolete locale entries because gettext can fall back to the source language; the native gate remains responsible for compiling every catalog with `msgfmt`.

### Comments and logs

Document intent where it is not obvious, especially around lifecycle, asynchronous invalidation, signal ownership, MPRIS/D-Bus edge cases, compatibility, and private Shell APIs.

The shared logger is retained for failures that matter during diagnosis and bounded once-only diagnostics for repeated endpoint or fallback failures. Do not log successful rendering, normal cleanup, expected capability absence, or routine state changes. Direct `console.*` calls stay inside the logger implementation.

## Test design

Prefer tests that exercise:

- pure decisions and normalization;
- persisted or external contracts;
- cross-file references required for build or runtime integrity;
- cancellation, owner replacement, and stale-result rejection;
- package safety and exact runtime inventory.

Do not add tests that merely count methods, lock incidental source layout, duplicate a constant without exercising behavior, or infer lifecycle correctness from method names. A small corruption fixture is useful only when it represents a defect the validator can identify exactly.

Automated checks complement review; they do not replace live validation of actors, signals, private Shell APIs, GSettings feedback, or real MPRIS implementations.

## Live testing

Runtime and lifecycle changes commonly require:

- enable, disable, reload, and repeated popup opening;
- native and browser-backed MPRIS sessions;
- multiple endpoints, selection, pinning, owner replacement, and grace periods;
- supported and unsupported MPRIS capabilities;
- affected top bar, popup, Preferences, artwork, and input paths;
- local, remote, cached, cancelled, and failed artwork requests;
- the GNOME media-controls patch when changed.

For settings feedback, run `dconf watch /org/gnome/shell/extensions/mediashell/` and verify that opening Preferences is silent while a user change produces only the expected writes.

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
- [`Gio.Settings` API](https://docs.gtk.org/gio/class.Settings.html)
- [GNOME extension review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
- [GNOME extension best practices](https://gjs.guide/extensions/review-guidelines/best-practices.html)
- [EGO AI reference](https://blogs.gnome.org/jrahmatzadeh/2026/07/27/ego-ai-reference/)
