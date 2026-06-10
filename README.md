# MediaShell – GNOME Shell Media Controls

Configurable MPRIS media controls for the GNOME Shell top bar.

[![Platform](https://img.shields.io/badge/Linux-platform?style=for-the-badge&logo=linux&logoColor=white&label=platform&labelColor=21262D&color=FFBC00)](https://www.kernel.org)
[![GNOME](https://img.shields.io/badge/47%E2%80%9350-versions?style=for-the-badge&logo=gnome&logoColor=white&label=GNOME&labelColor=21262D&color=3584E4)](https://release.gnome.org)
[![Release](https://img.shields.io/github/v/release/WSTxda/MediaShell?display_name=tag&style=for-the-badge&logo=github&labelColor=21262D&color=1F6FEB)](https://github.com/WSTxda/MediaShell/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/WSTxda/MediaShell/total?style=for-the-badge&labelColor=21262D&color=238636)](https://github.com/WSTxda/MediaShell/releases)
[![License](https://img.shields.io/github/license/WSTxda/MediaShell?style=for-the-badge&labelColor=21262D&color=6E7681)](LICENSE)

![MediaShell banner](assets/images/banner.svg)

MediaShell integrates configurable MPRIS media controls into the GNOME Shell top bar. It provides an **App selector**, **Track Information**, **Playback Controls**, **Volume Control**, **Album Art**, **Playback Progress**, and customizable **Mouse Actions** and **Keyboard Shortcuts**.

<details>
  <summary>Screenshots</summary>

Screenshots are published with the project releases and GNOME Extensions listing.

</details>

## Features

#### Top Bar

**App Icon:** Show the active media app with a symbolic or full-color icon.

**Track Information:** Display configurable metadata fields, custom text, width control, and optional scrolling.

**Playback Controls:** Add Play / Pause, Next Track, and Previous Track actions directly to the top bar.

**Visualizer:** Show an optional animated playback indicator with selectable style and speed.

**Element order:** Reorder App Icon, Track Information, Visualizer, and Playback Controls.

#### Popup

**App selector:** Switch between active media apps, pin the preferred app, or open the selected app.

**Album Art:** Display local or remote artwork with configurable corner radius and optional disk cache.

**Track Information:** Show Title, Artist, and Album with independent visibility and scrolling settings.

**Playback Progress:** Display position and duration, with seeking when supported by the media app.

**Playback Controls:** Control playback, shuffle, and repeat according to the capabilities exposed through MPRIS.

**Volume Control:** Adjust volume, mute, and restore the previous volume when the media app supports it.

#### Interactions and integration

**Mouse Actions:** Assign actions to clicks, scrolling, and touch gestures on the top bar button.

**Keyboard Shortcuts:** Configure global shortcuts for playback, volume, app, Popup, and Preferences actions.

**Blocked Apps:** Exclude installed apps from MediaShell without affecting their system-level MPRIS service.

**Panel placement:** Select the top bar section and index used by the extension.

**System media controls:** Optionally hide GNOME Shell's default media controls from the notification list.

## Compatibility

- GNOME Shell 47–50
- MPRIS-compatible media apps
- GTK 4 and Libadwaita 1.6 or later for Preferences

> [!IMPORTANT]
> MediaShell can only expose capabilities provided by each media app through MPRIS. Seeking, shuffle, repeat, volume, artwork, and app actions may not be available in every app.

> [!NOTE]
> Browser media sessions depend on the browser and website publishing a valid MPRIS service. A browser may create, replace, or remove media sessions while tabs and playback sources change.

## Installation

Download the latest extension package from [GitHub Releases](https://github.com/WSTxda/MediaShell/releases/latest), then install it with GNOME Extensions or the command line.

```bash
gnome-extensions install --force mediashell@wstxda.github.com.shell-extension.zip
gnome-extensions enable mediashell@wstxda.github.com
```

## Development

Use the Node.js and pnpm versions declared by `package.json`, together with GJS, GNU gettext, GLib resource and schema tools, GNOME Shell, and `gnome-extensions`.

```bash
pnpm doctor
pnpm check
pnpm build
```

The generated extension package is written to `dist/builds/`.

### Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Development](docs/DEVELOPMENT.md)
- [Settings](docs/SETTINGS.md)
- [UI contract](docs/UI_CONTRACT.md)
- [Validation](docs/VALIDATION.md)
- [Maintenance](docs/MAINTENANCE.md)

### Download

[<img src="https://raw.githubusercontent.com/WSTxda/WSTxda/main/images/GitHub.svg"
      alt="Get it on GitHub"
      height="80">](https://github.com/WSTxda/MediaShell/releases/latest)

### Donate

[<img src="https://raw.githubusercontent.com/WSTxda/WSTxda/main/images/PayPal.svg"
      alt="Donate with PayPal"
      height="80">](https://bit.ly/2lV0E6u) [<img src="https://raw.githubusercontent.com/WSTxda/WSTxda/main/images/BMC.svg"
      alt="Donate with Buy Me a Coffee"
      height="80">](https://www.buymeacoffee.com/wstxda)

### Credits

MediaShell is independently developed. The About dialog preserves acknowledgements for the Media Controls contributors whose work inspired parts of the project.
