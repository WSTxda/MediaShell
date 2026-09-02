# Development

[Contributing](../CONTRIBUTING.md) defines contribution requirements, including translations and review expectations. [Architecture](ARCHITECTURE.md) defines ownership, dependency boundaries, and runtime flows. This document covers the project-specific tools and implementation practices needed to work within those contracts.

## Environment and commands

Use the Node.js and pnpm versions declared in `package.json`. GNOME development requires GJS, GNOME Shell, `gnome-extensions`, GNU gettext, and the GLib schema/resource tools; release verification additionally requires `shexli`.

```bash
pnpm install
pnpm run env:doctor
```

`env:doctor` verifies the supported Shell and Libadwaita baseline and reports missing native tools. `pnpm run shell:debug` starts the supported nested development session for the installed GNOME version.

The commands normally used directly are:

| Command                  | Purpose                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| `pnpm test`              | Run toolkit-independent behavior and contract tests.                     |
| `pnpm run check:runtime` | Validate source, tests, declarative contracts, assets, and translations. |
| `pnpm check`             | Run the runtime gate and formatting verification.                        |
| `pnpm format`            | Format maintained project files with Prettier.                           |
| `pnpm run check:native`  | Validate schemas, resources, extraction, and catalogs with native tools. |
| `pnpm run check:package` | Validate the generated extension archive against the current checkout.   |
| `pnpm build`             | Run runtime/native gates, build the extension, and validate its archive. |
| `pnpm verify`            | Run the complete release gate, including `shexli`.                       |
| `pnpm run ext:reinstall` | Build, install, and enable the local package.                            |
| `pnpm run ext:prefs`     | Open the installed extension preferences.                                |

`package.json` is the authoritative command inventory. The `build:*` scripts are pipeline stages; invoke them directly only when diagnosing that stage.

## Validation model

The gates validate deterministic project facts rather than approximating architecture or UI behavior:

- JavaScript under `src/`, `scripts/`, and `tests/` is parsed as ECMAScript modules with the shared Acorn configuration.
- Runtime imports are resolved against real files and exports. The source graph rejects cycles, missing bindings, imports outside the packaged source tree, and Shell/Preferences/shared boundary violations.
- Extension and Preferences entrypoints are resolved through AST bindings and inheritance, so equivalent valid export syntax is accepted without textual source matching.
- Runtime API checks cover explicitly unsupported or removed APIs; they do not infer ownership or lifecycle from method names.
- Declarative checks parse metadata, schemas, GtkBuilder resources, D-Bus XML, settings definitions, and playback contracts and compare their actual values across representations.
- Asset checks parse resource manifests and images. Translation checks compare extracted source messages with the template and locale catalogs.
- Native validation runs the real GLib and gettext compilers.
- Package validation reads the ZIP with bounded expansion, rejects duplicate, unsafe, non-canonical, symlink, and special entries, verifies CRC/readability, parses packaged modules, resolves their imports, and compares every file digest with source or a freshly compiled artifact from the same checkout.

Regex is used only where the input itself has a lexical grammar, such as gettext directives, placeholders, version output, or a documented API/URI family. It is not used to decide JavaScript structure, ownership, or lifecycle.

Passing these gates establishes source and package integrity. It does not establish visual correctness, Shell actor lifecycle reachability, performance, real D-Bus behavior, or compatibility with private GNOME Shell internals.

## Integration map

Prepare the integration map required by [Contributing](../CONTRIBUTING.md) before a structural or cross-surface change. Trace current imports, settings flow, event flow, resource ownership, teardown, and compatibility-sensitive identifiers before choosing new files or abstractions.

The map is a review artifact, not a runtime layer. Its purpose is to identify the existing owner, the smallest valid integration point, code that will be reused, obsolete paths that will be removed, and the evidence needed to show that behavior was preserved.

## Modules and ownership

Follow the GJS naming convention: use lowerCamelCase for every JavaScript filename, including modules whose primary export is a class, and use PascalCase for class, GObject, and type names. Keep directories short, lowercase, and named for a cohesive process or subsystem. Keep a controller with the other controllers unless it owns a substantial subdomain; avoid one-file category directories.

Group constants by a cohesive domain contract, not merely by surface or directory. Constant modules contain pure values and frozen declarative data. Do not place `GObject` instances, toolkit objects, caches, mutable runtime state, or one-use implementation values in them. Move behavior to a utility only when it is stateless and genuinely reused; move it to `shared` only when both processes can consume it without toolkit coupling.

Construct extension-lifetime services in `ExtensionController`, inject the same instance into consumers that share its cache or in-flight work, and destroy consumers before the service. Do not hide lifecycle-owned service instances in module-global singletons.

Use lifecycle verbs consistently:

| Verb         | Contract                                                       |
| ------------ | -------------------------------------------------------------- |
| `create*`    | Always creates a new owned value or object.                    |
| `ensure*`    | Creates only when the owned value is absent.                   |
| `build*`     | Composes and returns a value.                                  |
| `render*`    | Presents current component state and may reuse owned actors.   |
| `resolve*`   | Derives a decision without taking ownership.                   |
| `sync*`      | Updates an existing value or object.                           |
| `reconcile*` | Moves owned state toward a target and may create or remove it. |
| `schedule*`  | Owns deferred work.                                            |
| `attach*`    | Places an existing actor or object.                            |
| `remove*`    | Detaches state while leaving the owner reusable.               |
| `destroy*`   | Performs final teardown.                                       |

Popup and Top Bar intentionally use separate actor owners. Align method names when operations have the same semantics, but do not introduce inheritance or a shared renderer merely because two components look similar. Surface geometry, actor placement, signals, animation, and teardown remain local unless their complete contracts are identical.

The creator of a signal connection, GLib source, cancellable, asynchronous generation, actor, private API override, or cache owns its cleanup. Invalidate or cancel work that can complete after an endpoint, component, window, or extension lifecycle is replaced.

## Project vocabulary

- `MediaApp` is the runtime entity discovered, selected, displayed, and controlled by MediaShell.
- `Player` refers to the `org.mpris.MediaPlayer2.Player` interface or proxy context, not to the generic runtime entity.
- `desktopApp` and `shellApp` distinguish installed application identity from an MPRIS endpoint when plain `app` would be ambiguous.

## High-risk change paths

### Settings and Preferences

A setting can span the GSettings schema, shared key/enum definitions, Shell `settingsSpec`, Preferences bindings or controllers, GtkBuilder objects, visible strings, translations, and tests. Trace and update every representation that actually participates in that setting.

### MPRIS and D-Bus

Keep endpoint discovery and lifetime in `MediaAppRegistry`, endpoint state and operations in `MprisMediaApp`, selection in its policy module, and surface actions on the shared control-definition/state/executor path. Capabilities and confirmed endpoint properties are authoritative; UI state is not.

Normalize endpoint metadata before identity or presentation decisions. Application-specific exceptions require a protocol or platform reason.

### Artwork and asynchronous work

Keep source access, shared requests, and cache policy in the loading service; keep decoding and stateless presentation calculations in utilities; keep actors, geometry, request generations, and cancellation in each surface owner. A late result must be rejected when its request, active endpoint, actor, or lifecycle is no longer current.

### Private Shell APIs

Private GNOME Shell access stays isolated in its compatibility adapter, capability-checked, reversible, and scoped to the feature that needs it.

## Tests, comments, and diagnostics

Prefer tests for pure decisions, normalization, persisted or external contracts, cross-file build/runtime integrity, owner replacement, cancellation, stale-result rejection, and reproducible package corruption.

Do not count methods, lock incidental source layout, duplicate constants without exercising behavior, or infer lifecycle correctness from names or source patterns. Add coverage only when an important behavior or compatibility contract is otherwise unprotected.

Comments should preserve non-obvious intent, ownership, protocol constraints, compatibility decisions, or lifecycle hazards. Use the shared logger for failures that help diagnosis and bounded logging for repeated failure paths; routine success, cleanup, and expected capability absence do not need logs.

## Live validation and debugging

Choose live scenarios from the changed ownership and contract:

- lifecycle changes: enable, disable, reload, and owner replacement;
- MPRIS changes: representative endpoint capabilities and more than one implementation when relevant;
- Preferences changes: opening the window must not write settings; explicit actions must write only their intended keys;
- UI changes: exercise the affected surface, state transitions, and supported GNOME versions;
- private API changes: test every supported GNOME release.

Useful diagnostics:

```bash
pnpm run shell:debug
journalctl --user -f -o cat /usr/bin/gnome-shell
dconf watch /org/gnome/shell/extensions/mediashell/
```

Record only the environment and output needed to reproduce the result.

## Release

From a clean tree:

```bash
pnpm verify
```

The validated archive is written under `dist/builds/`. Install it and exercise the affected runtime paths before publishing or submitting it.

## References

- [MPRIS specification](https://specifications.freedesktop.org/mpris/latest/)
- [GNOME Shell extension development](https://gjs.guide/extensions/)
- [GNOME extension preferences](https://gjs.guide/extensions/development/preferences.html)
- [`Gio.Settings` API](https://docs.gtk.org/gio/class.Settings.html)
- [GNOME extension review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
