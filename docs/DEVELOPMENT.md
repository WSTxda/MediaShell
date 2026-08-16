# Development

Contribution workflow and required translation updates are defined in [Contributing](../CONTRIBUTING.md). This document provides implementation and debugging guidance when a change needs additional technical context.

## Toolchain

Use the Node.js and pnpm versions declared by the project. GNOME development also requires GJS, GNOME Shell, `gnome-extensions`, GNU gettext, and GLib resource/schema tools. Release verification requires `shexli`.

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

Runtime validation is intentionally limited to checks with deterministic answers. Architecture, lifecycle ownership, UI behavior, and private GNOME Shell integration still require review and live testing.

## Working on a change

Start from the component that owns the behavior; see [Architecture](ARCHITECTURE.md). Extend an existing service, renderer, controller, executor, or lifecycle owner when its responsibility already matches the change. Do not introduce a parallel path simply because it is locally convenient.

Keep process boundaries intact:

- `src/shared/` contains toolkit-independent contracts and helpers;
- `src/shell/` contains GNOME Shell/St/Clutter runtime code;
- `src/prefs/` contains GTK4/Libadwaita Preferences code;
- Shell and Preferences communicate through shared contracts, resources, and GSettings rather than direct imports.

The creator of a signal connection, GLib source, cancellable, asynchronous generation, actor, or private API override owns its cleanup. When replacing an owner, invalidate or cancel work that can complete after replacement.

### Modules, names, and constants

Use PascalCase filenames when the primary export is an owning class with the same name. Use camelCase for functional modules, policies, enums, declarative tables, and pure helpers.

Constant modules contain pure values and frozen declarative data. Keep live `GObject`/toolkit instances, mutable runtime state, and trivial one-use implementation values with their owner. Move behavior into utilities only when the behavior itself is reusable.

Use lifecycle verbs consistently:

- `create*` always creates;
- `ensure*` creates only when absent;
- `build*` composes and returns a value;
- `resolve*` derives a decision;
- `sync*` updates existing state;
- `reconcile*` moves existing state toward a target, including create/remove when needed;
- `schedule*` owns deferred work;
- `attach*` places an existing actor;
- `remove*` leaves an owner reusable;
- `destroy*` performs final teardown.

### Naming vocabulary

- Use `MediaApp` for the runtime entity discovered, selected, displayed, and controlled by MediaShell.
- Use `Player` for the documented `org.mpris.MediaPlayer2.Player` interface/proxy context rather than as a generic name for a MediaShell runtime entity.
- Use `desktopApp` or `shellApp` for `Gio.AppInfo`, `Shell.App`, and desktop-entry resolution when plain `app` would be ambiguous.
- Preserve compact interface labels such as `Open app`, `Quit app`, `Switch app`, `Apps`, and `App icon`.
- `Blocked apps` refers to installed desktop applications listed by Preferences and should not be renamed to `Blocked media apps`.

Share implementation only after confirming identical inputs, outputs, side effects, ownership, lifecycle, teardown, and expected evolution. Do not merge or rename modules merely to make parallel code look symmetrical.

## Compatibility

Preserve shipped settings, enum values, D-Bus names, resource paths, GtkBuilder IDs, CSS classes, `GTypeName` strings, playback-control IDs, and other persisted or externally referenced contracts unless a compatibility change is deliberate.

When a contract changes, update every representation that depends on it and document migration requirements where users or external tooling are affected.

## Common change paths

### Settings and Preferences

A settings change can span the schema, shared key/spec definitions, Shell behavior, Preferences bindings/controllers, visible strings, translations, and contract tests. Keep those representations aligned.

Do not write settings as a side effect of enabling the extension or constructing Preferences. Initial synchronization must remain read-only unless an explicit migration requires otherwise.

### MPRIS and D-Bus

Route endpoint actions through the existing control definitions/state decisions and `MprisMediaApp`. Keep MPRIS method/property semantics and endpoint capabilities authoritative rather than inferring availability from UI state.

Normalize endpoint metadata before use. Keep desktop/browser/PWA identity resolution generic and evidence-based; application-specific exceptions require a protocol or platform reason, not just a convenient special case.

### Asynchronous work and artwork

Preserve ownership, cancellation, generation checks, active-endpoint checks, stream closure, and bounded resource behavior when changing asynchronous code. A result produced for an old owner must not mutate the current owner.

Keep source/loading concerns separate from surface presentation. Shared loading code must not own popup or top-bar actors.

### Comments and logs

Comments should explain non-obvious intent, ownership, protocol constraints, compatibility decisions, or lifecycle hazards. Avoid comments that merely restate the code or describe temporary UI details that are clearer from the implementation.

Use the shared logger for failures that matter during diagnosis and bounded diagnostics for repeated failure paths. Do not log successful rendering, routine cleanup, expected capability absence, or normal state changes. Direct `console.*` calls stay inside the logger implementation.

## Test design

Prefer tests for:

- pure decisions and normalization;
- persisted or external contracts;
- cross-file references required for build/runtime integrity;
- cancellation, owner replacement, and stale-result rejection;
- package safety and reproducible corruption cases.

Do not add tests that count methods, lock incidental source layout, duplicate constants without exercising behavior, or infer lifecycle correctness from names/source patterns. Adjust existing tests when a real contract changes; add coverage only when an important behavior is otherwise unprotected.

Automated checks complement review. They do not replace live validation of actor behavior, signal/lifecycle cleanup, GSettings feedback, private Shell APIs, or real MPRIS endpoints.

## Live testing

Choose live scenarios from the changed ownership and contracts rather than running an unrelated checklist. Runtime/lifecycle changes should cover enable/disable/reload and owner replacement. MPRIS changes should cover representative endpoint capabilities and more than one implementation when relevant. UI changes should be exercised on the affected surface, and private Shell API changes must be tested on every supported GNOME release.

For settings work, verify that opening Preferences does not create unintended writes and that explicit user changes produce only the expected settings updates. `dconf watch /org/gnome/shell/extensions/mediashell/` is useful for this.

Use Shell logs when needed:

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell
```

Record enough environment and reproduction information to make a failure repeatable: GNOME release, media app/MPRIS endpoint when relevant, affected settings, reproduction steps, and the smallest useful log excerpt.

## Release

From a clean tree:

```bash
pnpm check
pnpm build
pnpm verify
```

The generated package is under `dist/builds/`. Install and exercise the affected runtime paths before publishing the validated `.shell-extension.zip`.

## References

- [MPRIS Player interface](https://specifications.freedesktop.org/mpris/latest/Player_Interface.html)
- [GNOME Shell extension development](https://gjs.guide/extensions/)
- [Preferences and GSettings](https://gjs.guide/extensions/development/preferences.html)
- [`Gio.Settings` API](https://docs.gtk.org/gio/class.Settings.html)
- [GNOME extension review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
- [GNOME extension best practices](https://gjs.guide/extensions/review-guidelines/best-practices.html)
- [EGO AI reference](https://blogs.gnome.org/jrahmatzadeh/2026/07/27/ego-ai-reference/)
