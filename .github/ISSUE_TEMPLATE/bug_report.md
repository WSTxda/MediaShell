---
name: Bug report
about: Report a reproducible MediaShell problem
title: "[Bug]: "
labels: bug
assignees: ""
---

## Summary

Describe the problem and the result you expected.

## Reproduction

1.
2.
3.

## Environment

- GNOME Shell:
- Distribution:
- Session: Wayland / X11
- Media app or browser:
- MediaShell release or commit:

## Affected component

- [ ] Top Bar
- [ ] Popup
- [ ] App selector
- [ ] Track Information
- [ ] Playback Controls
- [ ] Progress Bar
- [ ] Volume actions
- [ ] Album Art
- [ ] Visualizer
- [ ] Mouse Actions
- [ ] Keyboard Shortcuts
- [ ] Blocked Apps
- [ ] System media controls
- [ ] Preferences
- [ ] Other

## MPRIS context

When relevant, include the `org.mpris.MediaPlayer2.*` bus name, `Identity`, `DesktopEntry`, playback state, and whether more than one media app was active.

## Logs

Provide a narrow log window around the failure. Remove unrelated or sensitive information.

```text
journalctl --user -o cat /usr/bin/gnome-shell
```

## Additional material

Add screenshots, screen recordings, or configuration details that help reproduce the problem.
