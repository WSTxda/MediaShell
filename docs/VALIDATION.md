# Validation

`pnpm check` is the canonical automated suite. A passing suite is required but does not replace live GNOME Shell testing.

## Automated checks

The repository validates:

- JavaScript parsing;
- relative imports, cycles, and process boundaries;
- GNOME Shell and Libadwaita compatibility contracts;
- settings, defaults, enums, migrations, and Preferences bindings;
- GtkBuilder IDs, schema, GResource, D-Bus XML, and translations;
- repository shape, package commands, assets, and documentation links;
- unit tests for shared logic;
- development command routing.

Focused commands:

```bash
pnpm test
python3 scripts/check-assets.py
bash scripts/check-development.sh
```

## Live matrix

Test the packaged extension on GNOME Shell 47, 48, 49, and 50.

For each affected release, validate:

- one native media app and one browser-backed media app;
- multiple simultaneous media apps;
- App selector selection, pinning, cycling, and app exit;
- MPRIS owner loss and replacement;
- Play / Pause, Next Track, Previous Track, Repeat, Shuffle, Volume Control, and seeking where supported;
- Popup open, close, reopen, focus loss, and outside dismissal;
- Top Bar element visibility, order, placement, and Track Information scrolling;
- Visualizer start, pause, hide, unmap, and teardown;
- extension enable, disable, reload, and repeated Preferences opening;
- Album Art loading, cancellation, cache recovery, and clearing;
- Blocked Apps selection and filtering;
- Keyboard Shortcuts and Mouse Actions;
- System media controls hiding and restoration.

## Browser scenarios

Exercise Chromium, Chrome, Brave, Edge, and Firefox when available. Include tab changes, short-form video feeds, rapid play and pause, page navigation, browser exit, and replacement MPRIS ownership.

## Release evidence

Record the commit, package checksum, tested GNOME Shell releases, media apps, automated output, known limitations, and focused logs for lifecycle or private Shell API behavior.
