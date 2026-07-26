# Development

## Toolchain

Use the Node.js and pnpm versions declared in `package.json`. GNOME development also needs GJS, GNOME Shell, `gnome-extensions`, GNU gettext, and GLib resource/schema tools. Release verification additionally needs `shexli`.

```bash
pnpm install
pnpm run env:doctor
pnpm run shell:debug
```

| Command                  | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `pnpm run check:runtime` | Validate source, parsed contracts, tests, assets, translations, and script syntax. |
| `pnpm check`             | Run runtime checks, formatting verification, and the advisory organization audit.  |
| `pnpm run audit`         | Report header, naming, logger-scope, and organization drift.                       |
| `pnpm run audit:strict`  | Treat the organization audit as a cleanup gate.                                    |
| `pnpm check:native`      | Run validation with native GLib/gettext tools.                                     |
| `pnpm build`             | Validate, compile resources, package, and inspect the archive.                     |
| `pnpm verify`            | Build and run `shexli` against the final package.                                  |

## Validation

Runtime checks cover imports, process boundaries, lifecycle patterns, metadata, settings, GtkBuilder, D-Bus XML, assets, translations, tests, and package contents. The organization audit reports documentation, naming, logger-scope, and source-layout drift without making those preferences part of normal runtime validation.

Automated checks cannot prove GNOME actor lifetime, private Shell API compatibility, or the behavior of real MPRIS implementations. Those areas require live testing.

## Working with the code

Start with the component that owns the behavior; the ownership map is in [Architecture](ARCHITECTURE.md). Extend the existing service, renderer, controller, executor, or lifecycle owner when one already fits the change.

Keep the process boundaries clear:

- `src/shared/` contains toolkit-independent values and helpers;
- `src/shell/` contains the GNOME Shell runtime and St/Clutter UI;
- `src/prefs/` contains the GTK4/Libadwaita Preferences runtime;
- Shell and Preferences communicate through shared contracts and GSettings.

Setup and teardown should make ownership equally clear. Signals, GLib sources, cancellables, asynchronous generations, and private API overrides are cleaned up by the component that creates them.

## Vocabulary and compatibility

Use **media app** for an MPRIS endpoint presented by MediaShell, **installed app** for desktop application metadata, and **player** for the MPRIS Player interface or official API names. Keep panel, top bar, and popup distinct.

Visible UI uses **Repeat** and **Open app**. Established protocol and compatibility values—such as `LoopStatus`, `Raise`, GSettings keys, enum values, D-Bus members, resource paths, CSS classes, and `GTypeName` strings—retain their existing values.

Shared pure constants and enums belong under `src/shared/`; process-specific policy remains in Shell or Preferences. Runtime objects and local algorithm details normally stay beside their owner.

## Common changes

### Settings

A setting change may involve the schema, JavaScript key/spec, Shell mapping, Preferences binding or controller, visible text, translations, tests, and documentation. Keep these representations aligned and preserve persisted values unless migration is part of the change.

### Playback, identity, and artwork

Playback actions use the shared control definitions, pure state decisions, `executePlaybackControlAction()`, and `PlayerProxy`. Relative seek buttons use `Seek(x)`; the progress bar uses `SetPosition(ox)`. UI state follows confirmed MPRIS capabilities and properties.

Normalize untrusted MPRIS data before display, and keep browser/PWA matching generic and evidence-based. Artwork work should preserve cancellation, request generations, active-endpoint checks, stream closure, cache recovery, and the existing size limits.

### Visible strings and translations

JavaScript strings use gettext helpers; GtkBuilder strings use `translatable="yes"`.

```bash
pnpm run translations
pnpm check
```

Preserve placeholders, plural forms, source references, translator comments, valid headers, and reviewed translations.

### Comments and logs

Module headers describe local purpose and ownership. Inline comments are useful where intent is not obvious, especially around lifecycle, asynchronous invalidation, signal ownership, MPRIS/D-Bus edge cases, compatibility, and private Shell APIs.

Logs should help diagnose failures or meaningful state transitions without narrating normal rendering and successful cleanup. Logger scopes follow the owning class or classless module.

## Live testing

Choose scenarios that cover the changed behavior. Runtime or lifecycle work commonly needs:

- enable, disable, reload, and repeated popup opening;
- native and browser-backed media sessions;
- multiple endpoints, selection, pinning, owner replacement, and grace windows;
- supported and unsupported playback capabilities;
- popup and top bar visibility, ordering, Width, and Lock width;
- local, remote, cached, cancelled, and failed artwork requests;
- mouse, touch, scroll, and keyboard input;
- Preferences opening/closing and the GNOME media-controls patch.

Use Shell logs when needed:

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell
```

Record the GNOME release, media app, MPRIS bus name, relevant settings, reproduction steps, and the smallest useful log excerpt.

## References

- [MPRIS Player interface](https://specifications.freedesktop.org/mpris/latest/Player_Interface.html)
- [GNOME Shell extension development](https://gjs.guide/extensions/)
- [Preferences and GSettings](https://gjs.guide/extensions/development/preferences.html)
- [GNOME extension review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)

## Release

From a clean tree:

```bash
pnpm check
pnpm build
pnpm verify
```

Install the package from `dist/builds/`, run the relevant live tests, and publish only the validated `.shell-extension.zip`.
