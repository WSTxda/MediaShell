#!/usr/bin/env python3
"""Validate parsed XML resources, schemas, D-Bus contracts, and gettext catalogs."""

from __future__ import annotations

import ast
import json
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zlib
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "assets"
LOCALE_DIR = ASSETS / "locale"
POT = LOCALE_DIR / "mediashell@wstxda.github.com.pot"
PACKAGE_JSON = ROOT / "package.json"
PLACEHOLDER_RE = re.compile(r"%(?:\d+\$)?[A-Za-z]|\{[A-Za-z_][A-Za-z0-9_]*\}")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
NATIVE_TOOL_NAMES = (
    "glib-compile-schemas",
    "glib-compile-resources",
    "xgettext",
    "msgfmt",
)


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

            match = re.match(
                r"(msgid_plural|msgid|msgstr(?:\[(\d+)\])?)\s+(.*)$",
                line,
            )
            if match:
                directive = match.group(1)
                index = match.group(2)
                current_field = (
                    f"msgstr[{index}]"
                    if directive.startswith("msgstr[")
                    else directive
                )
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


def validate_catalog_header(
    path: Path,
    entries: dict[str, CatalogEntry],
    language: str | None,
) -> list[str]:
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
    if not fields.get("Project-Id-Version", "").startswith("MediaShell "):
        errors.append(f"{path.name}: Project-Id-Version must identify MediaShell")
    if language is not None:
        if fields.get("Language") != language:
            errors.append(f"{path.name}: Language header must be {language!r}")
        if not fields.get("Plural-Forms"):
            errors.append(f"{path.name}: Plural-Forms header is required")
    return errors


def validate_source_references(
    path: Path,
    entries: dict[str, CatalogEntry],
) -> list[str]:
    errors: list[str] = []
    checked: set[str] = set()
    for entry in entries.values():
        for reference in entry.references:
            source_path = reference.rsplit(":", 1)[0]
            if source_path in checked:
                continue
            checked.add(source_path)
            if not (ROOT / source_path).is_file():
                errors.append(
                    f"{path.name}: source reference does not exist: {source_path}"
                )
    return errors


def extract_source_catalog_fallback() -> dict[str, CatalogEntry]:
    """Extract literal JavaScript and GtkBuilder messages from parsed sources."""
    result = subprocess.run(
        ["node", "scripts/dev/extractTranslations.mjs"],
        cwd=ROOT,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        raise SystemExit(
            "Translation validation failed:\n"
            f"- parsed JavaScript extraction failed: {result.stderr.strip()}"
        )

    entries: dict[str, CatalogEntry] = {}
    for item in json.loads(result.stdout):
        msgid = item.get("msgid")
        if not msgid:
            continue
        entries[msgid] = CatalogEntry(
            msgid=msgid,
            msgid_plural=item.get("msgidPlural"),
            references=list(item.get("references") or []),
        )

    for ui_path in sorted((ASSETS / "ui").glob("*.ui")):
        root = ET.parse(ui_path).getroot()
        for node in root.iter():
            if node.get("translatable") != "yes":
                continue
            msgid = "".join(node.itertext()).strip()
            if not msgid:
                continue
            reference = str(ui_path.relative_to(ROOT))
            entry = entries.setdefault(msgid, CatalogEntry(msgid=msgid))
            if reference not in entry.references:
                entry.references.append(reference)
    return entries


def extract_source_catalog(
    output_path: Path, *, require_native: bool = False
) -> dict[str, CatalogEntry]:
    """Extract messages with GNU gettext's JavaScript and Glade parsers."""
    xgettext = shutil.which("xgettext")
    if xgettext is None:
        if require_native:
            raise SystemExit("Translation validation failed: xgettext is required")
        return extract_source_catalog_fallback()

    javascript_paths = [
        str(path.relative_to(ROOT))
        for path in sorted((ROOT / "src").rglob("*.js"))
    ]
    ui_paths = [
        str(path.relative_to(ROOT))
        for path in sorted((ASSETS / "ui").glob("*.ui"))
    ]
    package_version = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))[
        "version"
    ]
    common_args = [
        "--from-code=UTF-8",
        "--add-comments",
        "--package-name=MediaShell",
        f"--package-version={package_version}",
    ]
    commands = [
        [
            xgettext,
            *common_args,
            "--keyword=_",
            "--keyword=ngettext:1,2",
            "--keyword=C_:1c,2",
            "--language=JavaScript",
            f"--output={output_path}",
            *javascript_paths,
        ],
        [
            xgettext,
            *common_args,
            "--join-existing",
            "--language=Glade",
            f"--output={output_path}",
            *ui_paths,
        ],
    ]

    for command in commands:
        result = subprocess.run(
            command,
            cwd=ROOT,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if result.returncode != 0:
            raise SystemExit(
                "Translation validation failed:\n"
                f"- xgettext failed: {result.stderr.strip()}"
            )

    return parse_catalog(output_path)


def validate_png(path: Path) -> list[str]:
    """Validate PNG structure, CRCs, and the compressed image stream."""
    data = path.read_bytes()
    label = str(path.relative_to(ROOT))
    if not data.startswith(PNG_SIGNATURE):
        return [f"{label}: invalid PNG signature"]

    errors: list[str] = []
    idat_parts: list[bytes] = []
    offset = len(PNG_SIGNATURE)
    chunk_index = 0
    saw_iend = False

    while offset < len(data):
        if len(data) - offset < 12:
            errors.append(f"{label}: truncated PNG chunk header")
            break

        length = int.from_bytes(data[offset : offset + 4], "big")
        chunk_type = data[offset + 4 : offset + 8]
        chunk_end = offset + 12 + length
        if chunk_end > len(data):
            chunk_name = chunk_type.decode("ascii", errors="replace")
            errors.append(f"{label}: truncated PNG {chunk_name} chunk")
            break

        chunk_data = data[offset + 8 : offset + 8 + length]
        expected_crc = int.from_bytes(data[offset + 8 + length : chunk_end], "big")
        actual_crc = zlib.crc32(chunk_type + chunk_data) & 0xFFFFFFFF
        if actual_crc != expected_crc:
            chunk_name = chunk_type.decode("ascii", errors="replace")
            errors.append(f"{label}: invalid CRC in {chunk_name} chunk")

        if chunk_index == 0 and chunk_type != b"IHDR":
            errors.append(f"{label}: first PNG chunk must be IHDR")
        if chunk_type == b"IDAT":
            idat_parts.append(chunk_data)
        elif chunk_type == b"IEND":
            saw_iend = True
            if chunk_end != len(data):
                errors.append(f"{label}: trailing data after IEND")
            break

        offset = chunk_end
        chunk_index += 1

    if not idat_parts:
        errors.append(f"{label}: PNG has no IDAT data")
    elif not errors:
        try:
            zlib.decompress(b"".join(idat_parts))
        except zlib.error as error:
            errors.append(f"{label}: PNG image stream is invalid: {error}")
    if not saw_iend:
        errors.append(f"{label}: PNG is missing IEND")
    return errors


def check_images() -> None:
    """Parse SVGs and decode PNG streams used by the project."""
    errors: list[str] = []
    image_paths = sorted((ASSETS / "images").rglob("*.png"))
    image_paths += sorted((ASSETS / "images").rglob("*.svg"))
    image_paths += sorted((ROOT / "src" / "icons").rglob("*.svg"))

    for path in image_paths:
        if path.suffix == ".png":
            errors.extend(validate_png(path))
            continue
        try:
            root = ET.parse(path).getroot()
            if not root.tag.endswith("svg"):
                errors.append(f"{path.relative_to(ROOT)}: root element is not <svg>")
        except ET.ParseError as error:
            errors.append(f"{path.relative_to(ROOT)}: invalid SVG XML: {error}")

    if errors:
        raise SystemExit(
            "Image validation failed:\n" + "\n".join(f"- {error}" for error in errors)
        )
    print(f"Image parsing and PNG decoding passed for {len(image_paths)} files.")


def parse_schema_default(key_node: ET.Element) -> object:
    default_node = key_node.find("default")
    if default_node is None:
        return None

    value = (default_node.text or "").strip()
    key_type = key_node.get("type")
    if key_type == "b":
        if value not in {"true", "false"}:
            raise ValueError(f"invalid boolean default {value!r}")
        return value == "true"
    if key_type in {"u", "i", "x", "t"}:
        return int(value)
    if key_type == "d":
        return float(value)
    if key_type == "as" or key_node.get("enum"):
        return ast.literal_eval(value)
    return value


def parse_dbus_contracts() -> tuple[
    dict[str, dict[str, list[str]]],
    dict[str, dict[str, dict[str, object]]],
]:
    """Return D-Bus member names and normalized signatures from maintained XML."""
    interfaces: dict[str, dict[str, list[str]]] = {}
    signatures: dict[str, dict[str, dict[str, object]]] = {}
    for dbus_path in sorted((ASSETS / "dbus").glob("*.xml")):
        for interface_node in ET.parse(dbus_path).findall(".//interface"):
            interface_name = interface_node.get("name")
            if not interface_name:
                continue

            interface_members = {
                member_type: [
                    member.get("name")
                    for member in interface_node.findall(member_type)
                    if member.get("name")
                ]
                for member_type in ("method", "signal", "property")
            }
            interface_signatures: dict[str, dict[str, object]] = {
                "method": {},
                "signal": {},
                "property": {},
            }

            for member_type in ("method", "signal"):
                for member in interface_node.findall(member_type):
                    member_name = member.get("name")
                    if not member_name:
                        continue
                    interface_signatures[member_type][member_name] = [
                        {
                            "name": argument.get("name"),
                            "type": argument.get("type"),
                            "direction": (
                                argument.get("direction", "in")
                                if member_type == "method"
                                else argument.get("direction")
                            ),
                        }
                        for argument in member.findall("arg")
                    ]

            for property_node in interface_node.findall("property"):
                property_name = property_node.get("name")
                if not property_name:
                    continue
                interface_signatures["property"][property_name] = {
                    "type": property_node.get("type"),
                    "access": property_node.get("access"),
                }

            interfaces[interface_name] = interface_members
            signatures[interface_name] = interface_signatures

    return interfaces, signatures


def build_asset_manifest() -> dict[str, object]:
    """Return parsed declarative facts for JavaScript contract checks."""
    schema_xml = ASSETS / "org.gnome.shell.extensions.mediashell.gschema.xml"
    schema_tree = ET.parse(schema_xml)
    schema_node = schema_tree.find(".//schema")
    if schema_node is None:
        raise ValueError("GSettings schema definition is missing")

    enums: dict[str, list[dict[str, object]]] = {}
    for enum_node in schema_tree.findall(".//enum"):
        enum_id = enum_node.get("id")
        if not enum_id:
            continue
        enums[enum_id] = [
            {"nick": value.get("nick"), "value": int(value.get("value", "0"))}
            for value in enum_node.findall("value")
        ]

    keys: dict[str, dict[str, object]] = {}
    for key_node in schema_node.findall("key"):
        key_name = key_node.get("name")
        if not key_name:
            continue
        range_node = key_node.find("range")
        keys[key_name] = {
            "type": key_node.get("type"),
            "enum": key_node.get("enum"),
            "default": parse_schema_default(key_node),
            "range": (
                {
                    "min": int(range_node.get("min", "0")),
                    "max": int(range_node.get("max", "0")),
                }
                if range_node is not None
                else None
            ),
        }

    ui_objects_by_source: dict[str, dict[str, dict[str, object]]] = {}
    ui_string_lists_by_source: dict[str, dict[str, list[str]]] = {}
    for ui_path in sorted((ASSETS / "ui").glob("*.ui")):
        source = str(ui_path.relative_to(ROOT))
        source_objects: dict[str, dict[str, object]] = {}
        source_string_lists: dict[str, list[str]] = {}
        for object_node in ET.parse(ui_path).findall(".//object"):
            object_id = object_node.get("id")
            if not object_id:
                continue
            if object_id in source_objects:
                raise ValueError(
                    f"{source}: duplicate GtkBuilder object ID {object_id}"
                )
            properties = {
                property_node.get("name"): "".join(property_node.itertext())
                for property_node in object_node.findall("property")
                if property_node.get("name")
            }
            source_objects[object_id] = {
                "class": object_node.get("class"),
                "properties": properties,
                "source": source,
            }
            if object_node.get("class") == "GtkStringList":
                source_string_lists[object_id] = [
                    "".join(item_node.itertext())
                    for item_node in object_node.findall("items/item")
                ]
        ui_objects_by_source[source] = source_objects
        ui_string_lists_by_source[source] = source_string_lists

    dbus_interfaces, dbus_signatures = parse_dbus_contracts()
    return {
        "schema": {
            "id": schema_node.get("id"),
            "path": schema_node.get("path"),
            "keys": keys,
            "enums": enums,
        },
        "uiObjectsBySource": ui_objects_by_source,
        "uiStringListsBySource": ui_string_lists_by_source,
        "dbusInterfaces": dbus_interfaces,
        "dbusSignatures": dbus_signatures,
    }


def check_resources() -> None:
    resource_xml = ASSETS / "org.gnome.shell.extensions.mediashell.gresource.xml"
    schema_xml = ASSETS / "org.gnome.shell.extensions.mediashell.gschema.xml"
    metadata_path = ROOT / "src" / "metadata.json"
    errors: list[str] = []

    check_images()

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
        raise SystemExit(
            "Resource validation failed:\n"
            + "\n".join(f"- {error}" for error in errors)
        )

    resource_tree = ET.parse(resource_xml)
    entries = [(node.text or "").strip() for node in resource_tree.findall(".//file")]
    entries = [entry for entry in entries if entry]
    if len(entries) != len(set(entries)):
        errors.append("GResource manifest contains duplicate entries")

    for entry in entries:
        if not (ASSETS / entry).is_file():
            errors.append(f"GResource manifest references missing file: {entry}")
        if entry.startswith(("images/", "locale/")):
            errors.append(f"development-only asset must not be bundled: {entry}")

    maintained_resource_files = {
        path.relative_to(ASSETS).as_posix()
        for directory in (ASSETS / "ui", ASSETS / "dbus")
        for path in directory.rglob("*")
        if path.is_file()
    }
    unbundled = maintained_resource_files - set(entries)
    for entry in sorted(unbundled):
        errors.append(f"maintained UI or D-Bus resource is not bundled: {entry}")

    for ui_path in sorted((ASSETS / "ui").glob("*.ui")):
        seen_ids: set[str] = set()
        for object_node in ET.parse(ui_path).findall(".//object"):
            object_id = object_node.get("id")
            if not object_id:
                continue
            if object_id in seen_ids:
                errors.append(
                    f"{ui_path.relative_to(ROOT)}: duplicate GtkBuilder "
                    f"object ID {object_id!r}"
                )
            seen_ids.add(object_id)

    schema = ET.parse(schema_xml).find(".//schema")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if schema is None:
        errors.append("GSettings schema definition is missing")
    elif schema.get("id") != metadata.get("settings-schema"):
        errors.append(
            "metadata settings-schema does not match the GSettings schema ID"
        )

    seen_interfaces: dict[str, Path] = {}
    for dbus_path in sorted((ASSETS / "dbus").glob("*.xml")):
        for interface in ET.parse(dbus_path).findall(".//interface"):
            interface_name = interface.get("name")
            if not interface_name:
                errors.append(
                    f"{dbus_path.relative_to(ROOT)}: unnamed D-Bus interface"
                )
                continue
            if interface_name in seen_interfaces:
                errors.append(
                    f"duplicate D-Bus interface {interface_name}: "
                    f"{seen_interfaces[interface_name].relative_to(ROOT)} and "
                    f"{dbus_path.relative_to(ROOT)}"
                )
            else:
                seen_interfaces[interface_name] = dbus_path

            for member_type in ("method", "signal", "property"):
                members = interface.findall(member_type)
                names = [member.get("name") for member in members]
                if any(not name for name in names):
                    errors.append(f"{interface_name}: unnamed {member_type}")
                if len(names) != len(set(names)):
                    errors.append(f"{interface_name}: duplicate {member_type} name")

            for argument in interface.findall(".//arg"):
                if not argument.get("type"):
                    errors.append(f"{interface_name}: D-Bus argument has no type")
                direction = argument.get("direction")
                if direction not in {None, "in", "out"}:
                    errors.append(
                        f"{interface_name}: invalid D-Bus argument direction {direction!r}"
                    )
            for property_node in interface.findall("property"):
                if not property_node.get("type"):
                    errors.append(
                        f"{interface_name}: property {property_node.get('name')} has no type"
                    )
                if property_node.get("access") not in {"read", "write", "readwrite"}:
                    errors.append(
                        f"{interface_name}: property {property_node.get('name')} "
                        "has invalid access"
                    )
    if errors:
        raise SystemExit(
            "Resource validation failed:\n"
            + "\n".join(f"- {error}" for error in errors)
        )

    print("Parsed resource, schema, UI, and D-Bus validation passed.")


def require_native_tools() -> dict[str, str]:
    """Return the complete native toolchain or fail once with all missing tools."""
    resolved_tools = {
        tool_name: shutil.which(tool_name) for tool_name in NATIVE_TOOL_NAMES
    }
    missing_tools = [
        tool_name
        for tool_name, executable in resolved_tools.items()
        if executable is None
    ]
    if missing_tools:
        raise SystemExit(
            "Native validation could not start:\n"
            + "\n".join(
                f"- {tool_name} is required" for tool_name in missing_tools
            )
        )
    return {
        tool_name: executable
        for tool_name, executable in resolved_tools.items()
        if executable is not None
    }


def check_native_resources(tools: dict[str, str]) -> None:
    """Run only the native GLib schema and resource compiler gate."""
    resource_xml = ASSETS / "org.gnome.shell.extensions.mediashell.gresource.xml"
    errors: list[str] = []

    schema_result = subprocess.run(
        [tools["glib-compile-schemas"], "--strict", "--dry-run", str(ASSETS)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if schema_result.returncode != 0:
        errors.append(
            f"glib-compile-schemas failed: {schema_result.stderr.strip()}"
        )

    with tempfile.TemporaryDirectory(
        prefix="mediashell-gresource-"
    ) as temporary_directory:
        output_path = Path(temporary_directory) / "mediashell.gresource"
        result = subprocess.run(
            [
                tools["glib-compile-resources"],
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
            errors.append(
                f"glib-compile-resources failed: {result.stderr.strip()}"
            )
        elif not output_path.is_file() or output_path.stat().st_size == 0:
            errors.append("glib-compile-resources produced an empty file")

    if errors:
        raise SystemExit(
            "Native resource validation failed:\n"
            + "\n".join(f"- {error}" for error in errors)
        )
    print("Native schema and resource compilation passed.")


def catalog_message_set(entries: dict[str, CatalogEntry]) -> set[str]:
    """Return singular and plural source messages without the header entry."""
    messages = set(entries) - {""}
    messages.update(
        entry.msgid_plural
        for entry in entries.values()
        if entry.msgid_plural is not None
    )
    return messages


def check_translations() -> None:
    errors: list[str] = []
    pot_entries = parse_catalog(POT)
    errors.extend(validate_catalog_header(POT, pot_entries, None))
    errors.extend(validate_source_references(POT, pot_entries))

    source_entries = extract_source_catalog_fallback()
    source_messages = catalog_message_set(source_entries)
    template_messages = catalog_message_set(pot_entries)

    missing = sorted(source_messages - template_messages)
    stale = sorted(template_messages - source_messages)
    if missing:
        errors.append(f"template is missing source messages: {missing}")
    if stale:
        errors.append(f"template contains stale source messages: {stale}")

    for po_path in sorted(LOCALE_DIR.glob("*.po")):
        entries = parse_catalog(po_path)
        language = po_path.stem
        errors.extend(validate_catalog_header(po_path, entries, language))

        for msgid, entry in entries.items():
            if not msgid or msgid not in pot_entries:
                continue

            template_entry = pot_entries[msgid]
            if entry.msgid_plural != template_entry.msgid_plural:
                errors.append(
                    f"{po_path.name}: plural source mismatch for {msgid!r}"
                )
                continue

            expected_forms = [msgid]
            if entry.msgid_plural is not None:
                expected_forms.append(entry.msgid_plural)

            for index, translation in entry.translations.items():
                if not translation:
                    continue
                expected_index = 0 if index == 0 else min(
                    1,
                    len(expected_forms) - 1,
                )
                expected = expected_forms[expected_index]
                if sorted(PLACEHOLDER_RE.findall(expected)) != sorted(
                    PLACEHOLDER_RE.findall(translation)
                ):
                    errors.append(
                        f"{po_path.name}: placeholder mismatch for "
                        f"{msgid!r} form {index}"
                    )

    if errors:
        raise SystemExit(
            "Translation validation failed:\n"
            + "\n".join(f"- {error}" for error in errors)
        )

    print(
        "Parsed translation template, references, headers, and placeholders "
        "passed. GNU gettext compilation belongs to the native gate."
    )


def check_native_translations(tools: dict[str, str]) -> None:
    """Run GNU gettext extraction and catalog compilation."""
    errors: list[str] = []

    pot_entries = parse_catalog(POT)
    with tempfile.TemporaryDirectory(
        prefix="mediashell-gettext-native-"
    ) as temporary_directory:
        source_entries = extract_source_catalog(
            Path(temporary_directory) / "source-messages.pot",
            require_native=True,
        )
    source_messages = catalog_message_set(source_entries)
    template_messages = catalog_message_set(pot_entries)
    missing = sorted(source_messages - template_messages)
    stale = sorted(template_messages - source_messages)
    if missing:
        errors.append(f"template is missing GNU gettext messages: {missing}")
    if stale:
        errors.append(f"template contains stale GNU gettext messages: {stale}")

    for po_path in sorted(LOCALE_DIR.glob("*.po")):
        with tempfile.TemporaryDirectory(
            prefix="mediashell-locale-native-"
        ) as temporary_directory:
            output_path = Path(temporary_directory) / f"{po_path.stem}.mo"
            result = subprocess.run(
                [
                    tools["msgfmt"],
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
                errors.append(
                    f"{po_path.name}: msgfmt failed: {result.stderr.strip()}"
                )
            elif not output_path.is_file() or output_path.stat().st_size == 0:
                errors.append(f"{po_path.name}: msgfmt produced an empty catalog")

    if errors:
        raise SystemExit(
            "Native translation validation failed:\n"
            + "\n".join(f"- {error}" for error in errors)
        )
    print("Native gettext extraction and catalog compilation passed.")


def main() -> None:
    if sys.argv[1:] == ["--manifest"]:
        print(json.dumps(build_asset_manifest(), ensure_ascii=False))
        return
    if sys.argv[1:] == ["--extract-translations"]:
        POT.unlink(missing_ok=True)
        extract_source_catalog(POT, require_native=True)
        return
    if sys.argv[1:] == ["--check-images"]:
        check_images()
        return
    if sys.argv[1:] == ["--check-resources"]:
        check_resources()
        return
    if sys.argv[1:] == ["--check-translations"]:
        check_translations()
        return
    if sys.argv[1:] == ["--check-native"]:
        tools = require_native_tools()
        check_native_resources(tools)
        check_native_translations(tools)
        return
    if sys.argv[1:]:
        raise SystemExit(
            "Usage: assets.py [--manifest|--extract-translations|--check-images|"
            "--check-resources|--check-translations|--check-native]"
        )

    check_resources()
    check_translations()


if __name__ == "__main__":
    main()
