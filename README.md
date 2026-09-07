# MediaShell – GNOME Media Controls

A GNOME extension that adds configurable MPRIS media controls to the top bar.

[![Platform](https://img.shields.io/badge/linux-platform?style=for-the-badge&logo=linux&logoColor=white&label=platform&labelColor=21262D&color=6E7681)](https://www.kernel.org)
[![GNOME](https://img.shields.io/badge/48%E2%80%9351-versions?style=for-the-badge&logo=gnome&logoColor=white&label=GNOME&labelColor=21262D&color=3584E4)](https://www.gnome.org)
[![Release](https://img.shields.io/github/v/release/WSTxda/MediaShell?display_name=release&style=for-the-badge&logo=github&labelColor=21262D&color=1F6FEB)](https://github.com/WSTxda/MediaShell/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/WSTxda/MediaShell/total?style=for-the-badge&labelColor=21262d&color=238636)](https://github.com/WSTxda/MediaShell/releases)

![Banner](https://raw.githubusercontent.com/WSTxda/MediaShell/main/assets/images/banner.svg)

MediaShell is a GNOME Shell extension for controlling MPRIS media from the top bar. Its customizable popup displays artwork, track information, playback controls, and a selector for switching between active media apps. The top bar and popup can be configured independently, while Preferences use GTK4 and Libadwaita.

<details>
  <summary><h3>Screenshots</h3></summary>

### Workspace

<table>
  <tr>
    <td align="center"><strong>Popup</strong></td>
    <td align="center"><strong>Popup media app selector</strong></td>
    <td align="center"><strong>Popup theming</strong></td>
  </tr>
  <tr>
    <td><img src="assets/images/screenshots/screen_popup.png" alt="MediaShell popup" width="100%"></td>
    <td><img src="assets/images/screenshots/screen_popup_app_selector.png" alt="MediaShell popup media app selector" width="100%"></td>
    <td><img src="assets/images/screenshots/screen_popup_theming.png" alt="MediaShell popup theming" width="100%"></td>
  </tr>
</table>

### Extension settings

<table>
  <tr>
    <td align="center"><strong>Popup</strong></td>
    <td align="center"><strong>Top bar</strong></td>
    <td align="center"><strong>Panel</strong></td>
  </tr>
  <tr>
    <td><img src="assets/images/screenshots/settings_popup.png" alt="MediaShell popup settings" width="100%"></td>
    <td><img src="assets/images/screenshots/settings_top_bar.png" alt="MediaShell top bar settings" width="100%"></td>
    <td><img src="assets/images/screenshots/settings_panel.png" alt="MediaShell panel settings" width="100%"></td>
  </tr>
</table>

<table>
  <tr>
    <td align="center"><strong>Interactions</strong></td>
    <td align="center"><strong>Others</strong></td>
    <td align="center"><strong>About</strong></td>
  </tr>
  <tr>
    <td><img src="assets/images/screenshots/settings_interactions.png" alt="MediaShell interactions settings" width="100%"></td>
    <td><img src="assets/images/screenshots/settings_others.png" alt="MediaShell other settings" width="100%"></td>
    <td><img src="assets/images/screenshots/settings_about.png" alt="MediaShell about dialog" width="100%"></td>
  </tr>
</table>

</details>

## Features

#### GNOME integration

- Built with GNOME Shell widgets, GTK4, and Libadwaita to fit naturally into the desktop.
- Hide GNOME's native media controls or enhance them with MediaShell controls where supported.

#### Independent top bar and popup

- Configure the top bar and popup independently.
- Arrange track information, app identity, artwork, playback controls, and the optional visualizer to match your layout.

#### Playback controls

- Control previous, play/pause, next, seeking, shuffle, and repeat through MPRIS when supported by the active media app.
- Add playback position, volume, and playback-speed controls to the popup when available.

#### Media app selector

- Switch between media apps currently available through MPRIS.
- Pin the selected media app for the current Shell session.
- Open or quit a media app when its MPRIS implementation supports the action.
- Block media apps you do not want MediaShell to display without affecting their MPRIS service.

#### Album art

- Display local or remote artwork in the popup and top bar.
- Use an optional persistent cache to improve repeated artwork loads.

#### Visualizer

- Add an optional visualizer to the top bar with multiple presentation styles.
- Animation follows the active media app's playback state.

#### Mouse and keyboard

- Assign mouse buttons, double click, and scroll directions to MediaShell actions.
- Use global shortcuts for playback, seeking, volume, media app actions, the popup, and Preferences.

## Requirements

- **GNOME Shell** 48–51
- A media app or browser session that exposes an **MPRIS** service

> [!IMPORTANT]
> MediaShell follows the capabilities and metadata reported by the active MPRIS media app. Controls or media information that the app does not expose cannot be provided reliably by the extension.

> [!NOTE]
> Browser MPRIS sessions are controlled by the browser and active website, so their identity and metadata may change as playback ownership moves between pages or tabs.

## Download

[<img src="https://raw.githubusercontent.com/WSTxda/WSTxda/main/images/GitHub.svg" alt="Get it on GitHub" height="80">](https://github.com/WSTxda/MediaShell/releases/latest)
[<img src="https://raw.githubusercontent.com/WSTxda/WSTxda/main/images/Telegram.svg" alt="Get it on Telegram" height="80">](https://t.me/WSTprojects)

## Manual installation

1. Download the latest extension package from [releases](https://github.com/WSTxda/MediaShell/releases/latest).
2. Install it using GNOME Extensions or the command line:

```bash
gnome-extensions install --force mediashell@wstxda.github.com.shell-extension.zip
```

3. After the first installation, start a new GNOME Shell session so the extension is discovered. On X11, GNOME Shell can instead be restarted with `Alt+F2`, `r`, and Enter.
4. Enable MediaShell:

```bash
gnome-extensions enable mediashell@wstxda.github.com
```

## Development

```bash
pnpm install
pnpm env:doctor
pnpm check
pnpm build:debug
```

`package.json` is the authoritative command list. See [Development](docs/DEVELOPMENT.md) for the development workflow and [Contributing](CONTRIBUTING.md) before making changes.

### Documentation

- [Contributing](CONTRIBUTING.md)
- [Development](docs/DEVELOPMENT.md)
- [Architecture](docs/ARCHITECTURE.md)

### Donate

[<img src="https://raw.githubusercontent.com/WSTxda/WSTxda/main/images/PayPal.svg" alt="Donate with PayPal" height="80">](https://www.paypal.com/donate/?cmd=_donations&business=wstxda@gmail.com&currency_code=USD)
[<img src="https://raw.githubusercontent.com/WSTxda/WSTxda/main/images/BMC.svg" alt="Donate with Buy Me a Coffee" height="80">](https://www.buymeacoffee.com/wstxda)

### Credits

**[Sakith B.](https://github.com/sakithb)**<br>
For your work on the [Media Controls](https://github.com/sakithb/media-controls) extension.
