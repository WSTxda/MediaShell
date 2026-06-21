# Development and validation

## Environment

Use the Node.js and pnpm versions declared in `package.json`. The GNOME runtime and compatibility list are declared in `src/metadata.json` and `src/shared/constants/platform.js`.

The development commands also require GJS, GNOME Shell, `gnome-extensions`, GNU gettext, and GLib resource tools. `pnpm verify` additionally expects `shexli` in `PATH`.

```bash
pnpm install
pnpm doctor
```

## Common commands

```bash
pnpm debug
pnpm test
pnpm check
pnpm build
pnpm verify
pnpm run check:package
pnpm run check:shexli
```

`pnpm check` is the maintained source validation entry point. It validates JavaScript syntax, import boundaries, compatibility declarations, review-sensitive API and lifecycle rules, MediaShell project invariants, packaging configuration, script wiring, settings references, documentation links, unit tests, XML resources, schemas, D-Bus contracts, translation catalogs, and the syntax of the development script.

`pnpm build` runs `pnpm check`, stages the runtime tree through `pnpm run build:stage`, builds the extension package, and then runs `pnpm run check:package` against `dist/builds/mediashell@wstxda.github.com.shell-extension.zip`. Use `pnpm run check:package` directly when inspecting that generated package, or pass a package path to `node scripts/check-package.mjs`.

`pnpm verify` is the release-oriented command. It runs `pnpm build` and then `pnpm run check:shexli` against the generated package.

`pnpm run check:shexli` runs `shexli dist/builds/mediashell@wstxda.github.com.shell-extension.zip`. When running `shexli` manually from the repository root, use the `dist/builds/` path; `shexli mediashell@wstxda.github.com.shell-extension.zip` only works if that file exists in the current directory.

`python3 scripts/check-assets.py` may be run directly while changing schemas, GtkBuilder files, D-Bus XML, GResources, or translations.

Set `MEDIASHELL_REQUIRE_NATIVE_TOOLS=1` when the validation environment must fail instead of skipping unavailable native compilers.

## Adding or changing settings

1. Define the key or enum in `assets/org.gnome.shell.extensions.mediashell.gschema.xml`.
2. Add Shell state mapping in `src/shell/settings/SettingsSpec.js` when runtime code consumes the setting.
3. Add a standard Preferences binding or a focused custom controller.
4. Reuse shared bounds and normalization where applicable.
5. Add a migration only when persisted compatibility requires it.
6. Update tests and translations for visible behavior.

Do not reuse an existing key for new semantics. Migrations must preserve user values, avoid overwriting an explicit destination value, and remain safe when run repeatedly.

## Translations

Visible strings in JavaScript use gettext, and GtkBuilder strings use `translatable="yes"`.

```bash
pnpm run translations
```

After changing visible text, verify the template and catalogs with `pnpm check`. Preserve placeholders and plural forms. Translation validation checks structure and format; it does not enforce a prescribed wording for each language.

## Risk-based live testing

Automated validation does not exercise GNOME Shell actor lifecycle, compositor behavior, private Shell APIs, or third-party MPRIS implementations. Test in proportion to the risk of the change.

### Full compatibility test

Use the complete supported compatibility list when a change affects:

- MPRIS discovery, owner changes, proxy state, or active selection;
- extension enable, disable, teardown, or signal ownership;
- GNOME Shell private APIs;
- version-sensitive Shell UI behavior;
- settings migrations or packaging compatibility.

Cover a native media app and a browser-backed session, multiple simultaneous endpoints, app exit, owner replacement, Popup reopening, Top Bar updates, extension reload, and the affected controls.

### Focused live test

Test the affected supported environment and interaction path when a change is limited to:

- Preferences layout or text;
- documentation or translations;
- isolated styling;
- a local UI component with unchanged lifecycle and data flow.

At minimum, enable the packaged extension, exercise the changed behavior, reopen Preferences when relevant, and disable the extension without errors.

## MPRIS scenarios

For lifecycle changes, include rapid play and pause, tab changes, page navigation, short-form media feeds, browser exit, endpoint replacement, and an app that omits optional capabilities.

For playback changes, exercise Play / Pause, Next Track, Previous Track, Repeat, Shuffle, seeking, volume actions, and application actions only where the endpoint advertises support.

## Debugging

Reproduce from a packaged build and inspect a focused Shell log stream:

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell
```

Record the Shell release, media app, MPRIS bus name, relevant settings, reproduction steps, and the smallest useful log excerpt.

## Release checks

1. Start from a clean tree.
2. Update release metadata in the manifest, package file, and gettext catalog headers.
3. Refresh translations when visible strings or source references change.
4. Run `pnpm check` for source validation.
5. Run `pnpm build`, which also validates the generated package contents.
6. Run `pnpm verify` before uploading to EGO.
7. Perform the live test level required by the changed subsystems.
8. Keep screenshots and store icon exports outside the installable package.
9. Publish the package generated under `dist/builds/`.

Do not maintain release instructions as prose duplication of checks that can be expressed in code. Add automated validation only when it catches an executable or structural failure without prescribing editorial wording.
