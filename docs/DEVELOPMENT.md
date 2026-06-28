# Development

Use the Node.js and pnpm versions declared in `package.json`. GNOME work also needs GJS, GNOME Shell, `gnome-extensions`, GNU gettext, and GLib resource tools. Release verification expects `shexli` in `PATH`.

```bash
pnpm install
pnpm doctor
pnpm debug
pnpm check
pnpm build
pnpm verify
```

`pnpm check` runs source validation, unit tests, resource/schema/D-Bus checks, translation checks, and script syntax. `pnpm build` stages and packs the extension, then validates the generated archive. `pnpm verify` builds the package and runs `shexli`.

## Where to start

Start from the owner of the behavior.

- Shell lifecycle and wiring: `src/shell/ExtensionController.js`.
- MPRIS discovery and active app selection: `src/shell/mpris/MediaAppRegistry.js` and `src/shell/mpris/MediaAppSelectionPolicy.js`.
- Media-app, browser, and PWA identity: `src/shared/utils/appIdentity.js`, `src/shared/utils/browserIdentity.js`, and `src/shell/services/MediaAppResolver.js`.
- One MPRIS endpoint: `src/shell/mpris/PlayerProxy.js`.
- Top bar UI: `src/shell/ui/topBar/TopBarButton.js` and the component beside the feature.
- Popup UI: `src/shell/ui/popup/PopupContent.js` and the component beside the feature.
- Preferences: `src/prefs/PreferencesController.js`, `src/prefs/bindings/PreferenceBindings.js`, or the relevant controller under `src/prefs/groups/`.

Keep Shell, Preferences, and Shared code separated. Shared modules must remain toolkit-independent and testable without GNOME.

## Naming

Use project vocabulary consistently in code, logs, comments, documentation, and visible strings.

- **Panel** configures extension placement in the GNOME Shell panel/top bar area.
- **Top Bar** configures the compact top bar button.
- **Popup** configures the menu opened from the top bar button.
- Use **app selector** for active media-app selection. Use chooser terminology only for blocked-app dialogs.
- Use **media app** for applications exposed in MediaShell UI. Use **player** only for MPRIS Player details, `PlayerProxy`, or protocol names.
- Use **top bar button** for the clickable Shell actor.
- Use **Progress Bar** for the user-facing popup setting and `PopupProgressBar` for runtime classes.

GSettings keys, schema enum IDs, D-Bus names, CSS classes, and GTypeName strings are stable contracts.

## Constants and enums

Use the narrowest module that owns the value:

- `src/shared/constants/timing.js`: timers, polling, retry intervals, grace periods, D-Bus timeouts.
- `src/shared/constants/limits.js`: cache capacities, payload sizes, and bounded request values.
- `src/shared/constants/settings.js`: user-facing settings defaults, ranges, and reset scopes.
- `src/shared/constants/dbus.js`: D-Bus names, paths, interfaces, and canonical MPRIS property lists.
- `src/shared/constants/inputActions.js`: input action descriptors and shortcut keys.
- `src/shared/constants/playbackControls.js`: transport-control descriptors shared by Top Bar and Popup.
- `src/shell/constants/actorState.js`: shared Shell actor opacity states.
- `src/shell/constants/popup.js`: popup-only layout and animation values.
- `src/shell/constants/visualizer.js`: visualizer layout, timing, and state values.
- `src/prefs/constants/layout.js`: preferences-only dialog and widget layout values created from JavaScript.

Extract a value when it is a shared contract, belongs to a tunable domain, or is likely to drift. Keep trivial one-off literals inline when that is clearer.

Add enums to the closest domain file under `src/shared/enums/`. Avoid runtime barrel modules because extension review checks JavaScript reachability from `extension.js` and `prefs.js`.

## Settings

1. Add the key or enum to `assets/org.gnome.shell.extensions.mediashell.gschema.xml`.
2. Add runtime mapping to `src/shell/settings/SettingsSpec.js` when Shell code consumes it.
3. Add a standard binding in `src/prefs/bindings/PreferenceBindings.js`, or use a page controller for compound UI.
4. Add transforms only when the runtime shape differs from the raw schema value.
5. Add a migration in `src/shared/settings/SettingsMigration.js` only when a legacy value must be preserved.
6. Update visible text, translations, tests, and documentation when the user-facing contract changes.

Never reuse an existing key, enum ID, or GTypeName for different semantics.

## Preferences controllers

Create page-level controllers under `src/prefs/groups/` when a preference needs coordination beyond a simple binding. Use a class name matching the file name and call `createLogger()` with the same scope.

Use `SignalConnections.js` when the controller owns signals from several source objects or requires explicit disconnect order. Use direct object lifetime helpers only when the source and owner lifetimes are tightly coupled.

## Code comments and logs

Every JavaScript module must start with a compact JSDoc header containing `@file`, `@module`, a short responsibility summary, and one purpose paragraph. The header complements the contributor documentation: it should say what the module owns and why it exists, not restate every export.

Use inline comments only for lifecycle, signal ownership, async teardown, MPRIS/D-Bus edge cases, GNOME compatibility, private Shell API boundaries, or non-obvious UI behavior. Avoid comments that merely repeat the next line of code.

Browser/PWA resolution must stay evidence-based. Prefer installed desktop-entry metadata, StartupWMClass, and MPRIS/runtime hints over hardcoded browser lists; fall back to the existing identity path when confidence is low. This feature should improve names, icons, blocklist matching, and focus targets without changing the App Selector, Top Bar, Popup layout, settings, or visible strings.

Use `createLogger("ClassName")` with a scope that matches the owning class or module. Logs should help diagnose failures and state transitions, not narrate ordinary render flow.

- `debug`: lifecycle details, cache decisions, media-app selection, and recoverable background work.
- `warn`: recoverable failures that affect a feature or require fallback behavior.
- `error`: component failures or teardown failures that may leave a feature broken.

## Translations

Visible JavaScript strings use gettext. GtkBuilder strings use `translatable="yes"`. After changing visible text, run:

```bash
pnpm run translations
pnpm check
```

Preserve placeholders, plural forms, source references, and translator comments. Do not erase a translation just because an English string was renamed; preserve it when the meaning is still correct, and leave it empty only when it needs native review.

## Live testing

Automated checks do not exercise compositor behavior, Shell actor lifetime, private Shell APIs, or real third-party MPRIS implementations. Test in proportion to risk.

For playback and lifecycle changes, cover:

- one native media app and one browser-backed session;
- multiple simultaneous endpoints;
- app exit and owner replacement;
- popup reopening and top bar updates;
- extension reload;
- rapid play/pause and capability changes;
- tab changes, page navigation, and short-form media feeds;
- seeking and volume actions when supported by the endpoint.

## Debugging

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell
```

Record the Shell release, media app, MPRIS bus name, relevant settings, reproduction steps, and the smallest useful log excerpt.

## Release

Start from a clean tree:

```bash
pnpm check
pnpm build
pnpm verify
```

Install the package from `dist/builds/`, run live tests for the changed subsystems, and publish only the validated `.shell-extension.zip`.
