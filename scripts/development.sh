#!/usr/bin/env bash
# Provides environment diagnostics and supported GNOME Shell development sessions.
set -euo pipefail

doctor_main() {
  missing_commands=()
  for command in node pnpm gjs glib-compile-resources glib-compile-schemas gnome-extensions gnome-shell msgfmt xgettext; do
    if ! command -v "$command" >/dev/null 2>&1; then
      missing_commands+=("$command")
    fi
  done

  if (( ${#missing_commands[@]} > 0 )); then
    printf 'MediaShell: missing development commands: %s\n' "${missing_commands[*]}" >&2
    exit 1
  fi

  node_major=$(node --version | sed -E 's/^v([0-9]+).*/\1/')
  if [[ ! "$node_major" =~ ^[0-9]+$ ]] || (( node_major < 20 )); then
    printf 'MediaShell: Node.js 20 or later is required; found %s.\n' "$(node --version 2>&1)" >&2
    exit 1
  fi

  shell_version_output=$(gnome-shell --version 2>&1) || {
    printf 'MediaShell: unable to read the GNOME Shell version.\n' >&2
    exit 1
  }
  if [[ "$shell_version_output" =~ ([0-9]+) ]]; then
    shell_major=${BASH_REMATCH[1]}
  else
    printf 'MediaShell: unable to parse the GNOME Shell version from: %s\n' "$shell_version_output" >&2
    exit 1
  fi
  if (( shell_major < 47 || shell_major > 50 )); then
    printf 'MediaShell: GNOME Shell 47 through 50 is required; found %s.\n' "$shell_version_output" >&2
    exit 1
  fi

  adwaita_version=$(gjs -c 'imports.gi.versions.Adw = "1"; const Adw = imports.gi.Adw; print(`${Adw.get_major_version()}.${Adw.get_minor_version()}.${Adw.get_micro_version()}`);' 2>&1) || {
    printf 'MediaShell: unable to load Libadwaita through GJS:\n%s\n' "$adwaita_version" >&2
    exit 1
  }
  if [[ "$adwaita_version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    adwaita_major=${BASH_REMATCH[1]}
    adwaita_minor=${BASH_REMATCH[2]}
  else
    printf 'MediaShell: unable to parse the Libadwaita version from: %s\n' "$adwaita_version" >&2
    exit 1
  fi
  if (( adwaita_major < 1 || (adwaita_major == 1 && adwaita_minor < 6) )); then
    printf 'MediaShell: Libadwaita 1.6 or later is required; found %s.\n' "$adwaita_version" >&2
    exit 1
  fi

  printf 'MediaShell development environment is ready: Node %s, %s, Libadwaita %s.\n' \
    "$(node --version)" "$shell_version_output" "$adwaita_version"
  if command -v gnome-shell-test-tool >/dev/null 2>&1 && (( shell_major >= 50 )); then
    printf 'GNOME Shell test-tool integration is available on this host.\n'
  fi
}

debug_main() {
  if ! command -v gnome-shell >/dev/null 2>&1; then
    printf 'MediaShell: gnome-shell was not found in PATH.\n' >&2
    exit 1
  fi

  if ! command -v dbus-run-session >/dev/null 2>&1; then
    printf 'MediaShell: dbus-run-session was not found in PATH.\n' >&2
    exit 1
  fi

  shell_version_output=$(gnome-shell --version 2>&1) || {
    printf 'MediaShell: unable to read the GNOME Shell version.\n' >&2
    exit 1
  }
  if [[ "$shell_version_output" =~ ([0-9]+) ]]; then
    shell_major=${BASH_REMATCH[1]}
  else
    shell_major=""
  fi

  if [[ -z "$shell_major" ]]; then
    printf 'MediaShell: unable to parse the GNOME Shell version from: %s\n' "$shell_version_output" >&2
    exit 1
  fi

  if (( shell_major < 47 || shell_major > 50 )); then
    printf 'MediaShell: supported GNOME Shell versions are 47 through 50; found %s.\n' "$shell_version_output" >&2
    exit 1
  fi

  export G_MESSAGES_DEBUG=all
  export SHELL_DEBUG=all

  if (( shell_major >= 49 )); then
    exec dbus-run-session gnome-shell --devkit --wayland
  fi

  exec dbus-run-session gnome-shell --nested --wayland
}

case "${1:-}" in
  doctor)
    doctor_main
    ;;
  debug)
    debug_main
    ;;
  *)
    printf 'Usage: %s {doctor|debug}\n' "$0" >&2
    exit 2
    ;;
esac
