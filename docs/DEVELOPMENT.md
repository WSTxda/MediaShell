# Development

## Toolchain

Use the Node.js and pnpm versions declared in `package.json`. GNOME development also needs GJS, GNOME Shell, `gnome-extensions`, GNU gettext, and GLib resource/schema tools. Release verification additionally needs `shexli`.

```bash
pnpm install
pnpm run env:doctor
pnpm run shell:debug
```

The maintained commands are:

| Command                  | Purpose                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `pnpm run check:runtime` | Validate executable code, parsed contracts, tests, assets, translations, and script syntax.              |
| `pnpm check`             | Run the runtime checks, formatting verification, and the advisory organization audit.                    |
| `pnpm run audit`         | Report module-header, filename/class, logger-scope, and source-organization drift without failing.       |
| `pnpm run audit:strict`  | Use the same audit as an explicit cleanup gate.                                                          |
| `pnpm check:native`      | Run the full check and require the native GLib compilers.                                                |
| `pnpm build`             | Validate, stage runtime files, compile resources, pack the extension, and inspect the generated archive. |
| `pnpm verify`            | Build and run `shexli` against the final extension package.                                              |

## Validation philosophy

Build failures must point to executable or declarative problems: invalid JavaScript, broken imports, process-boundary violations, lifecycle hazards, mismatched metadata/settings/UI/D-Bus contracts, malformed resources or translations, failing tests, or an invalid package.

Naming preferences, prose wording, file organization, and module documentation belong to the advisory audit. Do not turn cleanup decisions into permanent deny lists, retired-name checks, broad source regexes, or per-refactor build blockers. Add a blocking check only when it validates a stable contract or reproduces a real failure class.

Asset validation parses XML/SVG and decodes PNG container data, including CRCs and the compressed image stream. Translation validation compares source messages with the POT/PO catalogs, checks headers, plural forms, placeholders, and `msgfmt` output.

Automated checks do not prove GNOME actor lifetime, private Shell API compatibility, or behavior of real MPRIS implementations. Those require live testing.

## Code ownership

Start from the owner of the behavior:

- Shell lifecycle and wiring: `src/shell/ExtensionController.js`.
- MPRIS discovery and active-media-app selection: `src/shell/mpris/MediaAppRegistry.js` and `src/shell/mpris/mediaAppSelectionPolicy.js`.
- One MPRIS endpoint: `src/shell/mpris/PlayerProxy.js` and `PositionTracker.js`.
- Desktop/browser/PWA identity: `src/shared/utils/appIdentity.js`, `browserIdentity.js`, and `src/shell/services/MediaAppResolver.js`.
- Top bar: `src/shell/ui/topBar/`.
- Popup: `src/shell/ui/popup/`.
- Preferences lifecycle and bindings: `src/prefs/PreferencesController.js`, `bindings/`, and the relevant controller or widget.

Keep the process boundaries strict:

- `src/shared/` contains pure, toolkit-independent values and helpers.
- `src/shell/` may use GNOME Shell, St, Clutter, Meta, Gio, and GLib.
- `src/prefs/` may use GTK4, Libadwaita, Gdk, Gio, GLib, and GObject.
- Shell and Preferences must not import each other.

## Vocabulary

Use one name per project concept while preserving official API and protocol vocabulary.

- **Media app** is an MPRIS endpoint presented by MediaShell. Use `mediaApp`, `MediaApp*`, and `MEDIA_APP_*` according to JavaScript casing.
- **Available media apps** are eligible for the selector. **Active media app** is the one mounted in the top bar and popup. **Previous active media app** is the historical preference used by the selection policy.
- **Installed app** or **desktop application** refers to `Gio.AppInfo`, `Shell.App`, and desktop files.
- **Player** is reserved for the MPRIS Player interface, `PlayerProxy`, and platform API names.
- **Panel**, **top bar**, and **popup** are different surfaces: placement, compact button, and opened menu.
- Use **app selector** for switching media apps and **chooser** for selecting an app to block.
- Use **track information** for rendered fields and **metadata** for the raw MPRIS map and normalization pipeline.
- Use **album art** for the track image; `mpris:artUrl` remains the protocol key.
- Use **playback controls** for MediaShell buttons, **media controls** for the broader capability, and **GNOME media controls** for the native Shell controls.
- Use **keyboard shortcut** for the user feature, **keybinding** for `Main.wm.addKeybinding()`, and **accelerator** for GTK values/widgets.
- Visible UI uses **Repeat** and **Open app**. Internal `LoopStatus`, `toggleLoop()`, `Raise`, `raise()`, and shipped IDs remain unchanged because they are protocol or stable contracts.
- Write **D-Bus** in prose. Preserve forms such as `Gio.DBusProxy`, `DBUS_*`, `DbusMethods`, and `dbusProxy`.

GSettings keys, schema enum IDs, D-Bus names, CSS class values, resource URIs, and `GTypeName` strings are stable contracts. Naming cleanup may rename a JavaScript owner key, but must not alter the underlying value.

## Constants and enums

Use the narrowest truthful owner:

- cross-process pure contracts and shared tunables belong under `src/shared/constants/`;
- Shell-only visual/layout values belong under `src/shell/constants/`;
- Preferences-only policy/layout/style values belong under `src/prefs/constants/`;
- domain states belong in the closest file under `src/shared/enums/`.

Centralize shared protocol keys such as MPRIS metadata fields. Keep one-off literals, local algorithm details, and runtime objects such as `Gio.ThemedIcon` instances beside their owner. Do not create a constants module merely because the same generic icon or literal appears twice.

Use PascalCase filenames for class-owned modules and camelCase filenames for classless modules. Avoid runtime barrel files because the extension package and review tooling rely on explicit reachability from `extension.js` and `prefs.js`.

## Common changes

### Settings

1. Update the GSettings schema.
2. Add the JavaScript key/default/range owner when applicable.
3. Add the Shell runtime mapping only when Shell consumes the setting.
4. Add a normal preferences binding or a controller for compound behavior.
5. Update tests, visible text, translations, and docs when the user contract changes.

Never reuse a shipped key, enum ID, or `GTypeName` for a new meaning.

### Visible strings and translations

JavaScript strings use gettext helpers; GtkBuilder strings use `translatable="yes"`.

```bash
pnpm run translations
pnpm check
```

Preserve placeholders, plural forms, translator comments, and correct existing translations. Do not invent translator identities in PO headers. Leave a translation empty when native review is genuinely required.

### Comments and logs

Module headers state the local owner and purpose. Inline comments are useful for lifecycle, signal ownership, async teardown, MPRIS/D-Bus edge cases, compatibility, and private APIs—not for repeating the next line.

Logs should expose failures and meaningful state transitions without narrating ordinary rendering. Logger scopes match the owning class or classless module.

## Live testing

For runtime or lifecycle changes, test at least:

- enable, disable, reload, and repeated popup opening;
- one native media app and one browser-backed session;
- multiple simultaneous endpoints and app switching/pinning;
- endpoint exit, owner replacement, and browser tab/navigation changes;
- play, pause, stop, next, previous, shuffle, repeat, seek, and volume where supported;
- mouse actions, scroll, touch behavior, and keyboard shortcuts;
- Preferences opening/closing and the GNOME media-controls patch.

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

Install the package from `dist/builds/`, run the live tests relevant to the change, and publish only the validated `.shell-extension.zip`.
