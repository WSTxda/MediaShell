#!/usr/bin/env python3
"""Validate XML resources, schemas, D-Bus contracts, UI references, and gettext catalogs."""

from __future__ import annotations

import ast
import json
import os
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
LOCALE_DIR = ASSETS / "locale"
POT = LOCALE_DIR / "mediashell@wstxda.github.com.pot"
REQUIRE_NATIVE_TOOLS = os.environ.get("MEDIASHELL_REQUIRE_NATIVE_TOOLS") == "1"
PLACEHOLDER_RE = re.compile(r"%(?:\d+\$)?[A-Za-z]|\{[A-Za-z_][A-Za-z0-9_]*\}")


@dataclass
class CatalogEntry:
    msgid: str
    msgid_plural: str | None = None
    translations: dict[int, str] = field(default_factory=dict)
    references: list[str] = field(default_factory=list)


def decode_quoted(value: str) -> str:
    try:
        decoded = ast.literal_eval(value)
    except (SyntaxError, ValueError) as error:
        raise ValueError(f"invalid gettext string literal {value!r}: {error}") from error
    if not isinstance(decoded, str):
        raise ValueError(f"gettext literal is not a string: {value!r}")
    return decoded


def parse_catalog(path: Path) -> dict[str, CatalogEntry]:
    entries: dict[str, CatalogEntry] = {}
    block: list[str] = []

    def flush() -> None:
        nonlocal block
        if not block:
            return

        references: list[str] = []
        fields: dict[str, str] = {}
        current_field: str | None = None

        for line in block:
            if line.startswith("#~"):
                continue
            if line.startswith("#:"):
                references.extend(line[2:].strip().split())
                continue
            if line.startswith("#"):
                continue

            match = re.match(r"(msgid_plural|msgid|msgstr(?:\[(\d+)\])?)\s+(.*)$", line)
            if match:
                directive = match.group(1)
                index = match.group(2)
                current_field = f"msgstr[{index}]" if directive.startswith("msgstr[") else directive
                fields[current_field] = decode_quoted(match.group(3))
                continue

            if line.startswith('"') and current_field is not None:
                fields[current_field] += decode_quoted(line)

        msgid = fields.get("msgid")
        if msgid is not None:
            translations: dict[int, str] = {}
            if "msgstr" in fields:
                translations[0] = fields["msgstr"]
            for key, value in fields.items():
                match = re.fullmatch(r"msgstr\[(\d+)\]", key)
                if match:
                    translations[int(match.group(1))] = value
            entries[msgid] = CatalogEntry(
                msgid=msgid,
                msgid_plural=fields.get("msgid_plural"),
                translations=translations,
                references=references,
            )

        block = []

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line.strip():
            flush()
        else:
            block.append(raw_line)
    flush()
    return entries


def validate_catalog_header(path: Path, entries: dict[str, CatalogEntry], language: str | None) -> list[str]:
    errors: list[str] = []
    header = entries.get("")
    if header is None:
        return [f"{path.name}: missing gettext header"]

    header_text = header.translations.get(0, "")
    fields: dict[str, str] = {}
    for line in header_text.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        fields[key.strip()] = value.strip()

    if "charset=UTF-8" not in fields.get("Content-Type", ""):
        errors.append(f"{path.name}: Content-Type must declare charset=UTF-8")
    if fields.get("Content-Transfer-Encoding") != "8bit":
        errors.append(f"{path.name}: Content-Transfer-Encoding must be 8bit")
    if language is not None and fields.get("Language") != language:
        errors.append(f"{path.name}: Language header must be {language!r}")
    return errors


def validate_source_references(path: Path, entries: dict[str, CatalogEntry]) -> list[str]:
    errors: list[str] = []
    checked: set[str] = set()
    for entry in entries.values():
        for reference in entry.references:
            source_path = reference.rsplit(":", 1)[0]
            if source_path in checked:
                continue
            checked.add(source_path)
            if not (ROOT / source_path).is_file():
                errors.append(f"{path.name}: source reference does not exist: {source_path}")
    return errors


def extract_source_messages() -> set[str]:
    messages: set[str] = set()
    gettext_re = re.compile(r"\b_\(\s*(\"(?:\\.|[^\"\\])*\")\s*,?\s*\)")
    ngettext_re = re.compile(
        r"\bngettext\(\s*(\"(?:\\.|[^\"\\])*\")\s*,\s*"
        r"(\"(?:\\.|[^\"\\])*\")\s*,"
    )

    for js_path in sorted((ROOT / "src").rglob("*.js")):
        source = js_path.read_text(encoding="utf-8")
        for literal in gettext_re.findall(source):
            messages.add(decode_quoted(literal))
        for singular, plural in ngettext_re.findall(source):
            messages.add(decode_quoted(singular))
            messages.add(decode_quoted(plural))

    for ui_path in sorted((ASSETS / "ui").glob("*.ui")):
        for node in ET.parse(ui_path).iter():
            if node.get("translatable") == "yes" and node.text:
                messages.add(node.text)

    return messages


def run_optional_tool(name: str, args: list[str], error_prefix: str) -> subprocess.CompletedProcess[str] | None:
    executable = shutil.which(name)
    if executable is None:
        if REQUIRE_NATIVE_TOOLS:
            raise SystemExit(f"{error_prefix}: {name} is required when MEDIASHELL_REQUIRE_NATIVE_TOOLS=1")
        return None

    return subprocess.run(
        [executable, *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def check_resources() -> None:
    resource_xml = ASSETS / "org.gnome.shell.extensions.mediashell.gresource.xml"
    schema_xml = ASSETS / "org.gnome.shell.extensions.mediashell.gschema.xml"
    metadata_path = ROOT / "src" / "metadata.json"
    errors: list[str] = []

    xml_paths = [
        resource_xml,
        schema_xml,
        *sorted((ASSETS / "ui").glob("*.ui")),
        *sorted((ASSETS / "dbus").glob("*.xml")),
    ]
    for path in xml_paths:
        try:
            ET.parse(path)
        except ET.ParseError as error:
            errors.append(f"{path.relative_to(ROOT)}: invalid XML: {error}")

    if errors:
        raise SystemExit("Resource validation failed:\n" + "\n".join(f"- {error}" for error in errors))

    resource_tree = ET.parse(resource_xml)
    entries = [(node.text or "").strip() for node in resource_tree.findall(".//file")]
    entries = [entry for entry in entries if entry]
    if len(entries) != len(set(entries)):
        errors.append("GResource manifest contains duplicate entries")

    for entry in entries:
        if not (ASSETS / entry).is_file():
            errors.append(f"GResource manifest references missing file: {entry}")

    maintained_resource_files = {
        path.relative_to(ASSETS).as_posix()
        for directory in (ASSETS / "ui", ASSETS / "dbus")
        for path in directory.glob("*")
        if path.is_file()
    }
    unbundled = maintained_resource_files - set(entries)
    for entry in sorted(unbundled):
        errors.append(f"maintained UI or D-Bus resource is not bundled: {entry}")

    ui_ids: set[str] = set()
    for ui_path in sorted((ASSETS / "ui").glob("*.ui")):
        for object_node in ET.parse(ui_path).findall(".//object"):
            object_id = object_node.get("id")
            if object_id:
                ui_ids.add(object_id)

    for js_path in sorted((ROOT / "src" / "prefs").rglob("*.js")):
        source = js_path.read_text(encoding="utf-8")
        for widget_id in re.findall(r'get_object\("([^"]+)"\)', source):
            if widget_id not in ui_ids:
                errors.append(f"{js_path.relative_to(ROOT)} references unknown UI object: {widget_id}")

    schema = ET.parse(schema_xml).find(".//schema")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if schema is None:
        errors.append("GSettings schema definition is missing")
    elif schema.get("id") != metadata.get("settings-schema"):
        errors.append("metadata settings-schema does not match the GSettings schema ID")

    mpris_path = ASSETS / "dbus" / "mprisNode.xml"
    interfaces = {
        node.get("name"): node
        for node in ET.parse(mpris_path).findall(".//interface")
        if node.get("name")
    }
    required_members = {
        "org.freedesktop.DBus.Properties": {
            "method": {"Get", "GetAll", "Set"},
            "signal": {"PropertiesChanged"},
            "property": set(),
        },
        "org.mpris.MediaPlayer2": {
            "method": {"Raise", "Quit"},
            "signal": set(),
            "property": {"CanQuit", "CanRaise", "Identity", "DesktopEntry"},
        },
        "org.mpris.MediaPlayer2.Player": {
            "method": {"Next", "Previous", "Pause", "PlayPause", "Stop", "Play", "SetPosition"},
            "signal": {"Seeked"},
            "property": {
                "PlaybackStatus",
                "LoopStatus",
                "Rate",
                "Shuffle",
                "Metadata",
                "Volume",
                "Position",
                "CanGoNext",
                "CanGoPrevious",
                "CanPlay",
                "CanPause",
                "CanSeek",
                "CanControl",
            },
        },
    }

    for interface_name, member_groups in required_members.items():
        interface = interfaces.get(interface_name)
        if interface is None:
            errors.append(f"missing D-Bus interface: {interface_name}")
            continue
        for member_type, required_names in member_groups.items():
            actual_names = {node.get("name") for node in interface.findall(member_type)}
            for member_name in sorted(required_names - actual_names):
                errors.append(f"{interface_name}: missing {member_type} {member_name}")

    schema_result = run_optional_tool(
        "glib-compile-schemas",
        ["--strict", "--dry-run", str(ASSETS)],
        "Schema validation failed",
    )
    if schema_result is not None and schema_result.returncode != 0:
        errors.append(f"glib-compile-schemas failed: {schema_result.stderr.strip()}")

    resource_tool = shutil.which("glib-compile-resources")
    if resource_tool is None and REQUIRE_NATIVE_TOOLS:
        errors.append("glib-compile-resources is required when MEDIASHELL_REQUIRE_NATIVE_TOOLS=1")
    elif resource_tool is not None:
        with tempfile.TemporaryDirectory(prefix="mediashell-gresource-") as temporary_directory:
            output_path = Path(temporary_directory) / "mediashell.gresource"
            result = subprocess.run(
                [
                    resource_tool,
                    str(resource_xml),
                    f"--target={output_path}",
                    f"--sourcedir={ASSETS}",
                ],
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            if result.returncode != 0:
                errors.append(f"glib-compile-resources failed: {result.stderr.strip()}")
            elif not output_path.is_file() or output_path.stat().st_size == 0:
                errors.append("glib-compile-resources produced an empty file")

    if errors:
        raise SystemExit("Resource validation failed:\n" + "\n".join(f"- {error}" for error in errors))

    print("Resource, schema, UI, and D-Bus validation passed.")


def check_translations() -> None:
    errors: list[str] = []
    pot_entries = parse_catalog(POT)
    errors.extend(validate_catalog_header(POT, pot_entries, None))
    errors.extend(validate_source_references(POT, pot_entries))

    source_messages = extract_source_messages()
    pot_messages = set(pot_entries) - {""}
    pot_plural_messages = {
        entry.msgid_plural
        for entry in pot_entries.values()
        if entry.msgid_plural is not None
    }
    template_messages = pot_messages | pot_plural_messages

    missing = sorted(source_messages - template_messages)
    stale = sorted(template_messages - source_messages)
    if missing:
        errors.append(f"template is missing source messages: {missing}")
    if stale:
        errors.append(f"template contains stale source messages: {stale}")

    msgfmt = shutil.which("msgfmt")
    if msgfmt is None and REQUIRE_NATIVE_TOOLS:
        errors.append("msgfmt is required when MEDIASHELL_REQUIRE_NATIVE_TOOLS=1")

    for po_path in sorted(LOCALE_DIR.glob("*.po")):
        entries = parse_catalog(po_path)
        errors.extend(validate_catalog_header(po_path, entries, po_path.stem))
        errors.extend(validate_source_references(po_path, entries))

        for msgid, entry in entries.items():
            if not msgid or msgid not in pot_entries:
                continue

            template_entry = pot_entries[msgid]
            if entry.msgid_plural != template_entry.msgid_plural:
                errors.append(f"{po_path.name}: plural source mismatch for {msgid!r}")
                continue

            expected_forms = [msgid]
            if entry.msgid_plural is not None:
                expected_forms.append(entry.msgid_plural)

            for index, translation in entry.translations.items():
                if not translation:
                    continue
                expected = expected_forms[0 if index == 0 else min(1, len(expected_forms) - 1)]
                if sorted(PLACEHOLDER_RE.findall(expected)) != sorted(PLACEHOLDER_RE.findall(translation)):
                    errors.append(f"{po_path.name}: placeholder mismatch for {msgid!r} form {index}")

        if msgfmt is not None:
            with tempfile.TemporaryDirectory(prefix="mediashell-locale-") as temporary_directory:
                output_path = Path(temporary_directory) / f"{po_path.stem}.mo"
                result = subprocess.run(
                    [
                        msgfmt,
                        "--check",
                        "--check-header",
                        "--check-format",
                        "--output-file",
                        str(output_path),
                        str(po_path),
                    ],
                    check=False,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                if result.returncode != 0:
                    errors.append(f"{po_path.name}: msgfmt failed: {result.stderr.strip()}")

    if errors:
        raise SystemExit("Translation validation failed:\n" + "\n".join(f"- {error}" for error in errors))

    print("Translation template, references, headers, and placeholders passed.")


def main() -> None:
    check_resources()
    check_translations()


if __name__ == "__main__":
    main()
