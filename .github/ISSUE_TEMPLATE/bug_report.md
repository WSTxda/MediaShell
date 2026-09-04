---
name: Bug report
about: Report a reproducible MediaShell problem
title: "[Bug]: "
labels: bug
assignees: ""
---

## Summary

Describe what happened and what you expected instead. Mention whether this is a regression and, if known, the last MediaShell version or commit where it worked.

## Reproduction

1.
2.
3.

Keep the steps minimal. If the failure depends on opening the popup, changing a setting, switching players, seeking, locking the screen, or starting a second MPRIS player, include that transition explicitly.

## Environment

- MediaShell release or commit:
- GNOME Shell version:
- Distribution:
- Session: Wayland / X11
- Player, browser, or PWA:
- Player version, when relevant:

## Affected area

- [ ] MPRIS player discovery / lifecycle
- [ ] Player selector / pinning
- [ ] Desktop app identity / AppIcon
- [ ] Artwork / artwork cache
- [ ] Track information
- [ ] Playback controls
- [ ] Progress / seeking
- [ ] Volume
- [ ] Top bar
- [ ] Popup
- [ ] Visualizer
- [ ] Mouse actions
- [ ] Keyboard shortcuts
- [ ] Blocked apps
- [ ] Native media controls: Default
- [ ] Native media controls: Hidden
- [ ] Native media controls: Enhanced
- [ ] Lock screen
- [ ] Preferences / settings
- [ ] Other

## MPRIS context

When relevant, include the `org.mpris.MediaPlayer2.*` bus name, `Identity`, `DesktopEntry`, playback state, and whether more than one player was active. For seeking problems, note whether the player normally exposes seek support.

## Logs

Include a narrow log window around the failure. MediaShell logs use the `[MediaShell]` prefix. Remove unrelated or sensitive information before posting.

```text
journalctl --user -b -o cat /usr/bin/gnome-shell | grep MediaShell
```

If the filtered output omits useful surrounding errors, attach the relevant unfiltered journal excerpt as well.

## Additional material

Add screenshots, a short screen recording, or configuration details when they make the problem easier to reproduce. Do not attach a full system journal unless it is necessary.
