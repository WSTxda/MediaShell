# Development and validation

## Environment

Use the Node.js and pnpm versions declared in `package.json`. The GNOME runtime baseline lives in `src/metadata.json` and `src/shared/constants/platform.js`.

Development commands require GJS, GNOME Shell, `gnome-extensions`, GNU gettext, and GLib resource tools. `pnpm verify` also requires `shexli` in `PATH`.

```bash
pnpm install
pnpm doctor
```

## Navigation

- Shell runtime code lives in `src/shell/`.
- Preferences code lives in `src/prefs/`.
- Toolkit-independent constants, enums, migrations, and utilities live in `src/shared/`.
- GtkBuilder templates, schemas, D-Bus XML, and translations live in `assets/`.
- Tests for pure logic and policies live in `tests/`.

Start from the owner. Shell changes usually begin at `ExtensionController`, `MediaAppRegistry`, `PlayerProxy`, `TopBarButton`, or `PopupContent`. Preferences changes usually begin at `PreferencesController`, `PreferenceBindings`, or the relevant page controller in `src/prefs/groups/`.

## Commands

```bash
pnpm debug
pnpm test
pnpm check
pnpm build
pnpm verify
```

`pnpm check` validates source syntax, import boundaries, compatibility declarations, GNOME review-sensitive patterns, project invariants, packaging configuration, settings references, documentation links, unit tests, resources, schemas, D-Bus contracts, translations, and script syntax.

`pnpm build` runs `pnpm check`, stages the runtime tree, compiles resources, creates the package, and runs `check-package` against `dist/builds/mediashell@wstxda.github.com.shell-extension.zip`. `pnpm verify` builds the package and runs `shexli`.

## Constants

Use the narrowest constants module that owns the value:

- `src/shared/constants/timing.js`: timers, retry delays, polling intervals, grace periods, D-Bus call timeouts.
- `src/shared/constants/limits.js`: cache capacities, payload sizes, request limits.
- `src/shared/constants/settings.js`: user-facing settings bounds and defaults.
- `src/shared/constants/dbus.js`: D-Bus names, paths, and canonical MPRIS property lists.
- `src/shared/constants/inputActions.js`: input action descriptors and shortcut keys.
- `src/shared/constants/playbackControls.js`: transport-control descriptors shared by top bar and popup.
- `src/shell/constants/ui.js`: Shell-only layout measurements.

Do not create a local magic number for a tunable domain value; trivial literals may remain inline when clearer.

## Enums and widget flags

Add new domain enums to the closest file under `src/shared/enums/` and import that domain file directly from consumers. Avoid runtime barrel enum modules because EGO checks every JavaScript file for reachability from `extension.js` or `prefs.js`.

For a new UI component update flag, add an individual bit to `WidgetFlags` in `src/shared/enums/widget.js`, update the relevant compound flag, then consume the bit in `TopBarButton.updateWidgets()` or `PopupContent.updateWidgets()`.

## Settings

1. Add the key or enum to `assets/org.gnome.shell.extensions.mediashell.gschema.xml`.
2. Add runtime mapping to `src/shell/settings/SettingsSpec.js` when Shell code consumes it.
3. Add a standard binding in `src/prefs/bindings/PreferenceBindings.js`, or wire a page controller when the UI is compound.
4. Add transforms only when the runtime shape differs from the raw schema value.
5. Add a migration in `src/shared/settings/SettingsMigration.js` only when a legacy value must be preserved.
6. Update visible text/translations when strings change, then run `pnpm check`.

GSettings key names, enum IDs, and GTypeName strings are public contracts; never reuse them for new semantics.

## Preference page controllers

Create page-level controllers under `src/prefs/groups/`, use a class name matching the file name, and call `createLogger()` with the same class name. Instantiate and destroy them from `PreferencesController`. Use `SignalConnections.js` when the controller manually owns signals from several source objects or needs explicit disconnect order.

## Logging

Use `createLogger("ClassName")` with a scope that exactly matches the class name in the same file.

- `debug`: internal state transitions, cache hits/misses, lifecycle details, and recoverable background work.
- `warn`: recoverable failures that affect a feature or require fallback behavior.
- `error`: unrecoverable component failures or teardown failures that may leave a feature broken.

## Conservative choices

- Compatibility re-exports remain in modules that previously exported moved enums or constants. Remove them only as a deliberate module API change.
- Preferences controllers use `SignalConnections.js` when they own signals from several source objects or need explicit disconnect order. Use `connectObject()` only for local GObject instances with direct owner lifetime.
- Clutter intervals keep explicit `GObject.Value` wrappers where typed interval values avoid implicit binding conversion differences across supported Shell releases.
- Gio cancellation checks live in `src/shell/utils/errors.js`; do not reintroduce local `isCancellationError()` helpers.
- Visual constants should be unified only when states are semantically equivalent, not just numerically similar.

## Translations

Visible JavaScript strings use gettext. GtkBuilder strings use `translatable="yes"`. After changing visible text, run `pnpm run translations` and `pnpm check`; preserve placeholders and plural forms.

## Live testing

Automated validation does not exercise GNOME Shell actor lifecycle, compositor behavior, private Shell APIs, or real third-party MPRIS implementations. Test in proportion to the risk of the change.

For playback and lifecycle changes, cover one native media app and one browser-backed session, multiple simultaneous endpoints, app exit, owner replacement, popup reopening, top bar updates, extension reload, rapid play/pause, tab changes, page navigation, short-form media feeds, seeking, volume actions, and only the controls the endpoint advertises.

## Debugging

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell
```

Record the Shell release, media app, MPRIS bus name, relevant settings, reproduction steps, and the smallest useful log excerpt.

## Release

Before publishing: run `pnpm check`, `pnpm build`, and `pnpm verify`. Start from a clean tree. Update release metadata, refresh translations if visible strings changed, perform the live tests required by the changed subsystems, and publish the package from `dist/builds/`.
