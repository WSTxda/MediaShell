# Settings

MediaShell stores preferences in `org.gnome.shell.extensions.mediashell`.

## Sources of truth

- Schema and defaults: `assets/org.gnome.shell.extensions.mediashell.gschema.xml`
- Shell mapping and update impact: `src/shell/settings/SettingsSpec.js`
- Preferences bindings: `src/prefs/bindings/PreferenceBindings.js`
- Historical migration: `src/shared/settings/SettingsMigration.js`
- Shared bounds: `src/shared/constants/settings.js`

## Groups

### Popup

Controls Popup width, Playback Progress, Album Art, Track Information, App selector icon style, Playback Controls, and Volume Control.

### Top Bar

Controls Track Information width and content, scrolling, App Icon, Playback Controls, Visualizer, and element visibility.

### Panel

Controls the top bar section, index, and persisted element order.

### Interactions

Controls Mouse Actions and Keyboard Shortcuts.

### Others

Controls System media controls, Album Art Cache, Blocked Apps, and settings reset.

## Persistence rules

- Never reuse a key for different semantics.
- GSettings enums persist their nick values; preserve historical nicks when compatibility depends on them.
- Renamed keys remain available as migration sources until supported profiles no longer require them.
- A migration copies a legacy user value only when the destination has no user value.
- Migrations must be idempotent.
- Invalid runtime values are normalized to safe bounds without rewriting unrelated preferences.

## Update scope

`SettingsSpec` assigns each setting either a focused widget impact or a controller action. Prefer the narrowest update that fully reconciles the changed state. Rebuild the top bar button only for placement changes that cannot be applied in place.

## Reset behavior

The Preferences reset action returns current settings to schema defaults. It does not delete external media app data or GNOME settings.
