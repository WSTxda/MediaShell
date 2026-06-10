#!/usr/bin/env bash
# Verifies both development command modes against the supported platform baseline.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
LAUNCHER="$ROOT/scripts/development.sh"
DOCTOR="$ROOT/scripts/development.sh"
TEMP_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEMP_DIRECTORY"' EXIT

bash -n "$LAUNCHER"

write_mocks() {
  local shell_version=$1
  cat > "$TEMP_DIRECTORY/gnome-shell" <<MOCK
#!/usr/bin/bash
if [[ \${1:-} == "--version" ]]; then
  printf '%s\\n' '$shell_version'
  exit 0
fi
printf 'gnome-shell %s\\n' "\$*"
MOCK
  cat > "$TEMP_DIRECTORY/dbus-run-session" <<'MOCK'
#!/usr/bin/bash
printf '%s\n' "$*"
MOCK
  chmod +x "$TEMP_DIRECTORY/gnome-shell" "$TEMP_DIRECTORY/dbus-run-session"
}

for version in 47.0 48.7; do
  write_mocks "GNOME Shell $version"
  nested_output=$(PATH="$TEMP_DIRECTORY" /usr/bin/bash "$LAUNCHER" debug)
  [[ "$nested_output" == "gnome-shell --nested --wayland" ]] || {
    printf 'Expected GNOME %s nested mode, received: %s\n' "$version" "$nested_output" >&2
    exit 1
  }
done

for version in 49.0 50.1; do
  write_mocks "GNOME Shell $version"
  devkit_output=$(PATH="$TEMP_DIRECTORY" /usr/bin/bash "$LAUNCHER" debug)
  [[ "$devkit_output" == "gnome-shell --devkit --wayland" ]] || {
    printf 'Expected GNOME %s devkit mode, received: %s\n' "$version" "$devkit_output" >&2
    exit 1
  }
done

for unsupported_version in 45.9 51.0; do
  write_mocks "GNOME Shell $unsupported_version"
  if PATH="$TEMP_DIRECTORY" /usr/bin/bash "$LAUNCHER" debug >"$TEMP_DIRECTORY/stdout" 2>"$TEMP_DIRECTORY/stderr"; then
    printf 'Unsupported GNOME %s unexpectedly succeeded.\n' "$unsupported_version" >&2
    exit 1
  fi
  grep -q "supported GNOME Shell versions are 47 through 50" "$TEMP_DIRECTORY/stderr"
done

write_mocks "GNOME Shell development build"
if PATH="$TEMP_DIRECTORY" /usr/bin/bash "$LAUNCHER" debug >"$TEMP_DIRECTORY/stdout" 2>"$TEMP_DIRECTORY/stderr"; then
  printf 'Malformed GNOME Shell version unexpectedly succeeded.\n' >&2
  exit 1
fi
grep -q "unable to parse the GNOME Shell version" "$TEMP_DIRECTORY/stderr"

rm -f "$TEMP_DIRECTORY/gnome-shell"
if PATH="$TEMP_DIRECTORY" /usr/bin/bash "$LAUNCHER" debug >"$TEMP_DIRECTORY/stdout" 2>"$TEMP_DIRECTORY/stderr"; then
  printf 'Missing gnome-shell unexpectedly succeeded.\n' >&2
  exit 1
fi
grep -q "gnome-shell was not found" "$TEMP_DIRECTORY/stderr"

DOCTOR_DIRECTORY="$TEMP_DIRECTORY/doctor"
mkdir -p "$DOCTOR_DIRECTORY"

write_doctor_mocks() {
  local shell_version=$1
  local adwaita_version=$2
  rm -f "$DOCTOR_DIRECTORY"/*

  cat > "$DOCTOR_DIRECTORY/node" <<'MOCK'
#!/usr/bin/bash
if [[ ${1:-} == "--version" ]]; then
  printf '%s\n' 'v22.0.0'
fi
MOCK
  cat > "$DOCTOR_DIRECTORY/gnome-shell" <<MOCK
#!/usr/bin/bash
if [[ \${1:-} == "--version" ]]; then
  printf '%s\n' '$shell_version'
fi
MOCK
  cat > "$DOCTOR_DIRECTORY/gjs" <<MOCK
#!/usr/bin/bash
printf '%s\n' '$adwaita_version'
MOCK
  for command in pnpm glib-compile-resources glib-compile-schemas gnome-extensions msgfmt xgettext; do
    cat > "$DOCTOR_DIRECTORY/$command" <<'MOCK'
#!/usr/bin/bash
exit 0
MOCK
  done
  chmod +x "$DOCTOR_DIRECTORY"/*
}

doctor_path="$DOCTOR_DIRECTORY:/usr/bin:/bin"
for version in 47.0 50.1; do
  write_doctor_mocks "GNOME Shell $version" "1.6.0"
  doctor_output=$(PATH="$doctor_path" /usr/bin/bash "$DOCTOR" doctor)
  grep -q "development environment is ready" <<<"$doctor_output"
done

for unsupported_version in 45.9 51.0; do
  write_doctor_mocks "GNOME Shell $unsupported_version" "1.6.0"
  if PATH="$doctor_path" /usr/bin/bash "$DOCTOR" doctor >"$TEMP_DIRECTORY/stdout" 2>"$TEMP_DIRECTORY/stderr"; then
    printf 'Environment doctor accepted unsupported GNOME %s.\n' "$unsupported_version" >&2
    exit 1
  fi
  grep -q "GNOME Shell 47 through 50 is required" "$TEMP_DIRECTORY/stderr"
done

write_doctor_mocks "GNOME Shell development build" "1.6.0"
if PATH="$doctor_path" /usr/bin/bash "$DOCTOR" doctor >"$TEMP_DIRECTORY/stdout" 2>"$TEMP_DIRECTORY/stderr"; then
  printf 'Environment doctor accepted malformed GNOME Shell output.\n' >&2
  exit 1
fi
grep -q "unable to parse the GNOME Shell version" "$TEMP_DIRECTORY/stderr"

write_doctor_mocks "GNOME Shell 47.0" "1.5.99"
if PATH="$doctor_path" /usr/bin/bash "$DOCTOR" doctor >"$TEMP_DIRECTORY/stdout" 2>"$TEMP_DIRECTORY/stderr"; then
  printf 'Environment doctor accepted Libadwaita below the declared baseline.\n' >&2
  exit 1
fi
grep -q "Libadwaita 1.6 or later is required" "$TEMP_DIRECTORY/stderr"

write_doctor_mocks "GNOME Shell 47.0" "1.6.0"
rm -f "$DOCTOR_DIRECTORY/xgettext"
if PATH="$DOCTOR_DIRECTORY" /usr/bin/bash "$DOCTOR" doctor >"$TEMP_DIRECTORY/stdout" 2>"$TEMP_DIRECTORY/stderr"; then
  printf 'Environment doctor accepted a missing native command.\n' >&2
  exit 1
fi
grep -q "missing development commands:.*xgettext" "$TEMP_DIRECTORY/stderr"

printf 'Development shell checks passed for GNOME 47-50 routing, explicit launcher failures, and workstation baseline diagnostics.\n'
