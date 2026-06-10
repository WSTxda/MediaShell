#!/usr/bin/env python3
# Verifies GResource, schema, UI, D-Bus XML, and gettext catalog contracts.
from __future__ import annotations


def main() -> None:
    # Verifies UI resources, GResource manifests, MPRIS introspection XML, and native resource tooling.
    def check_resources():
        import json
        import os
        import re
        import shutil
        import subprocess
        import tempfile
        from pathlib import Path
        import xml.etree.ElementTree as ET

        root = Path(__file__).resolve().parents[1]
        assets = root / "assets"
        resource_xml = assets / "org.gnome.shell.extensions.mediashell.gresource.xml"
        schema_xml = assets / "org.gnome.shell.extensions.mediashell.gschema.xml"
        mpris_xml = assets / "dbus" / "mprisNode.xml"
        metadata_json = root / "src" / "metadata.json"

        xml_paths = [
            resource_xml,
            schema_xml,
            *sorted((assets / "ui").glob("*.ui")),
            *sorted((assets / "dbus").glob("*.xml")),
        ]
        for xml_path in xml_paths:
            ET.parse(xml_path)

        schema_compiler = shutil.which("glib-compile-schemas")
        if schema_compiler is None:
            bundled_compiler = Path("/usr/lib/x86_64-linux-gnu/glib-2.0/glib-compile-schemas")
            if bundled_compiler.is_file():
                schema_compiler = str(bundled_compiler)
        resource_compiler = shutil.which("glib-compile-resources")
        require_native_tools = os.environ.get("MEDIASHELL_REQUIRE_NATIVE_TOOLS") == "1"

        schema_compiler_status = "XML parsed; glib-compile-schemas was not available"
        if schema_compiler is not None:
            subprocess.run(
                [schema_compiler, "--strict", "--dry-run", str(assets)],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            schema_compiler_status = "schema compiler dry-run passed"
        elif require_native_tools:
            raise SystemExit(
                "Resource contract check failed:\n"
                "- glib-compile-schemas is required when MEDIASHELL_REQUIRE_NATIVE_TOOLS=1"
            )

        resource_compiler_status = "manifest parsed; glib-compile-resources was not available"
        if resource_compiler is not None:
            with tempfile.TemporaryDirectory(prefix="mediashell-resources-") as temporary_directory:
                output_path = Path(temporary_directory) / "mediashell.gresource"
                subprocess.run(
                    [
                        resource_compiler,
                        str(resource_xml),
                        f"--target={output_path}",
                        f"--sourcedir={assets}",
                    ],
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                if not output_path.is_file() or output_path.stat().st_size == 0:
                    raise SystemExit("Resource contract check failed:\n- compiled GResource output is empty")
            resource_compiler_status = "GResource compilation passed"
        elif require_native_tools:
            raise SystemExit(
                "Resource contract check failed:\n"
                "- glib-compile-resources is required when MEDIASHELL_REQUIRE_NATIVE_TOOLS=1"
            )

        errors = []
        resource_tree = ET.parse(resource_xml)
        resource_entries = set()
        for node in resource_tree.findall(".//file"):
            source = (node.text or "").strip()
            if not source:
                continue
            resource_entries.add(source)
            if not (assets / source).is_file():
                errors.append(f"Missing resource file: {source}")

        required_resources = {
            "dbus/mprisNode.xml",
            "dbus/watchNode.xml",
            "ui/prefs.ui",
            "ui/blocked-apps.ui",
            "ui/top-bar-element-order.ui",
            "ui/top-bar-track-information-content-row.ui",
        }
        for source in sorted(required_resources - resource_entries):
            errors.append(f"Required resource is not bundled: {source}")

        ui_ids = set()
        for ui_path in sorted((assets / "ui").glob("*.ui")):
            for object_node in ET.parse(ui_path).findall(".//object"):
                object_id = object_node.get("id")
                if object_id:
                    ui_ids.add(object_id)

        for js_path in sorted((root / "src" / "prefs").rglob("*.js")):
            source = js_path.read_text(encoding="utf-8")
            for widget_id in re.findall(r'get_object\("([^"]+)"\)', source):
                if widget_id not in ui_ids:
                    errors.append(f"{js_path.relative_to(root)} references unknown UI object: {widget_id}")

        prefs_tree = ET.parse(assets / "ui" / "prefs.ui")
        prefs_root = prefs_tree.getroot()
        parent_by_node = {child: parent for parent in prefs_root.iter() for child in parent}
        objects_by_id = {
            node.get("id"): node
            for node in prefs_root.findall(".//object")
            if node.get("id")
        }

        def direct_child_objects(object_node):
            if object_node is None:
                return []
            return [
                child.find("object")
                for child in object_node.findall("child")
                if child.find("object") is not None
            ]

        def object_property(object_node, name):
            if object_node is None:
                return None
            property_node = object_node.find(f"property[@name='{name}']")
            return property_node.text if property_node is not None else None

        track_content_row = objects_by_id.get("er-top-bar-track-information-content")
        track_information_expander = objects_by_id.get("er-top-bar-track-information")
        if track_content_row is None:
            errors.append("Top Bar Metadata is missing the Track Information Content expander")
        else:
            child_wrapper = parent_by_node.get(track_content_row)
            metadata_group = parent_by_node.get(child_wrapper) if child_wrapper is not None else None
            if metadata_group is None or object_property(metadata_group, "title") != "Metadata":
                errors.append("Track Information Content must be a direct row in the Top Bar Metadata group")
            if object_property(track_content_row, "expanded") != "false":
                errors.append("Track Information Content must start collapsed")
            ancestor = child_wrapper
            while ancestor is not None:
                if ancestor is track_information_expander:
                    errors.append("Track Information Content must be a sibling of Track Information, not nested inside it")
                    break
                ancestor = parent_by_node.get(ancestor)

        interaction_page = objects_by_id.get("page-interactions")
        interaction_group_titles = [
            object_property(group, "title") for group in direct_child_objects(interaction_page)
        ]
        if interaction_group_titles != ["Keyboard Shortcuts", "Mouse Actions"]:
            errors.append(
                "Interactions must contain separate Keyboard Shortcuts and Mouse Actions groups "
                f"in that order, found {interaction_group_titles}"
            )

        others_page = objects_by_id.get("page-others")
        others_group_titles = [
            object_property(group, "title") or group.get("id")
            for group in direct_child_objects(others_page)
        ]
        expected_others_groups = ["System", "Album Art Cache", "gp-others-blocked-apps", "Reset"]
        if others_group_titles != expected_others_groups:
            errors.append(
                "Others page group order must remain System, Album Art Cache, Blocked Apps, Reset; "
                f"found {others_group_titles}"
            )

        schema_tree = ET.parse(schema_xml)
        schema = schema_tree.find(".//schema")
        metadata = json.loads(metadata_json.read_text(encoding="utf-8"))
        if schema is None:
            errors.append("GSettings schema definition is missing")
        else:
            schema_id = schema.get("id")
            if schema_id != metadata.get("settings-schema"):
                errors.append(
                    f"metadata settings-schema {metadata.get('settings-schema')!r} does not match {schema_id!r}"
                )

        mpris_tree = ET.parse(mpris_xml)
        interfaces = {node.get("name"): node for node in mpris_tree.findall(".//interface")}
        required_interfaces = {
            "org.freedesktop.DBus.Properties",
            "org.mpris.MediaPlayer2",
            "org.mpris.MediaPlayer2.Player",
        }
        for interface_name in sorted(required_interfaces - interfaces.keys()):
            errors.append(f"Missing D-Bus interface: {interface_name}")

        required_members = {
            "org.freedesktop.DBus.Properties": {
                "method": {"Get", "GetAll", "Set"},
                "signal": {"PropertiesChanged"},
                "property": set(),
            },
            "org.mpris.MediaPlayer2": {
                "method": {"Raise", "Quit"},
                "signal": set(),
                "property": {
                    "CanQuit", "Fullscreen", "CanSetFullscreen", "CanRaise", "HasTrackList",
                    "Identity", "DesktopEntry", "SupportedUriSchemes", "SupportedMimeTypes",
                },
            },
            "org.mpris.MediaPlayer2.Player": {
                "method": {"Next", "Previous", "Pause", "PlayPause", "Stop", "Play", "SetPosition", "OpenUri"},
                "signal": {"Seeked"},
                "property": {
                    "PlaybackStatus", "LoopStatus", "Rate", "Shuffle", "Metadata", "Volume", "Position",
                    "MinimumRate", "MaximumRate", "CanGoNext", "CanGoPrevious", "CanPlay", "CanPause",
                    "CanSeek", "CanControl",
                },
            },
        }
        for interface_name, member_types in required_members.items():
            interface = interfaces.get(interface_name)
            if interface is None:
                continue
            for member_type, expected_names in member_types.items():
                actual_names = {node.get("name") for node in interface.findall(member_type)}
                for name in sorted(expected_names - actual_names):
                    errors.append(f"{interface_name} is missing {member_type} {name}")

        if errors:
            raise SystemExit("Resource contract check failed:\n" + "\n".join(f"- {error}" for error in errors))

        print(
            f"Resource contract check passed: {len(resource_entries)} bundled files, "
            f"{len(ui_ids)} UI object IDs, required MPRIS interfaces, {schema_compiler_status}, and {resource_compiler_status}."
        )

    check_resources()

    # Verifies gettext template/catalog consistency, placeholders, and plural forms.
    def check_translations():
        """Validate gettext catalogs without requiring gettext Python bindings."""

        import ast
        import os
        import re
        import shutil
        import subprocess
        import tempfile
        from pathlib import Path
        import xml.etree.ElementTree as ET

        ROOT = Path(__file__).resolve().parents[1]
        LOCALE_DIR = ROOT / "assets" / "locale"
        POT = LOCALE_DIR / "mediashell@wstxda.github.com.pot"
        PLACEHOLDER_RE = re.compile(r"%(?:\d+\$)?[a-zA-Z]")

        CANONICAL_TERMS: dict[str, dict[str, str]] = {
            "be": {
                "Top Bar": "Верхняя панэль",
                "Popup": "Усплывальнае меню",
                "Album Art": "Вокладка альбома",
                "Track Information": "Звесткі аб трэку",
                "Playback Controls": "Элементы кіравання прайграваннем",
                "App Icon": "Значок праграмы",
                "Blocked Apps": "Заблакіраваныя праграмы",
                "Visualizer": "Візуалізатар",
                'Add Item': 'Дадаць элемент',
                'Track Information Content': 'Змесціва звестак аб трэку',
                'Scroll track information': 'Пракручваць звесткі аб трэку',
                'Hide system media controls': 'Схаваць сістэмныя элементы кіравання медыя',
                'Middle Click': 'Сярэдні клік',
                'View all...': 'Паказаць усіх...',
            },
            "ca": {
                "Top Bar": "Barra superior",
                "Popup": "Finestra emergent",
                "Album Art": "Caràtula de l’àlbum",
                "Track Information": "Informació de la pista",
                "Playback Controls": "Controls de reproducció",
                "App Icon": "Icona de l’aplicació",
                "Blocked Apps": "Aplicacions bloquejades",
                "Visualizer": "Visualitzador",
                'Add Item': 'Afegeix un element',
                'Track Information Content': 'Contingut de la informació de la pista',
                'Scroll track information': 'Desplaça la informació de la pista',
                'Hide system media controls': 'Amaga els controls multimèdia del sistema',
                'Middle Click': 'Clic del mig',
                'View all...': 'Mostra-ho tot...',
            },
            "cs": {
                "Top Bar": "Horní lišta",
                "Popup": "Vyskakovací okno",
                "Album Art": "Obal alba",
                "Track Information": "Informace o skladbě",
                "Playback Controls": "Ovládací prvky přehrávání",
                "App Icon": "Ikona aplikace",
                "Blocked Apps": "Blokované aplikace",
                "Visualizer": "Vizualizér",
                'Add Item': 'Přidat položku',
                'Track Information Content': 'Obsah informací o skladbě',
                'Scroll track information': 'Posouvat informace o skladbě',
                'Hide system media controls': 'Skrýt systémové ovládání médií',
                'Middle Click': 'Prostřední klik',
                'View all...': 'Zobrazit vše...',
            },
            "de": {
                "Top Bar": "Obere Leiste",
                "Popup": "Pop-up",
                "Album Art": "Albumcover",
                "Track Information": "Titelinformationen",
                "Playback Controls": "Wiedergabesteuerung",
                "App Icon": "App-Symbol",
                "Blocked Apps": "Blockierte Apps",
                "Visualizer": "Visualisierer",
                'Add Item': 'Element hinzufügen',
                'Track Information Content': 'Inhalt der Titelinformationen',
                'Scroll track information': 'Titelinformationen scrollen',
                'Hide system media controls': 'System-Mediensteuerung ausblenden',
                'Middle Click': 'Mittelklick',
                'View all...': 'Alle anzeigen...',
            },
            "es": {
                "Top Bar": "Barra superior",
                "Popup": "Ventana emergente",
                "Album Art": "Carátula del álbum",
                "Track Information": "Información de la pista",
                "Playback Controls": "Controles de reproducción",
                "App Icon": "Icono de la aplicación",
                "Blocked Apps": "Aplicaciones bloqueadas",
                "Visualizer": "Visualizador",
                'Add Item': 'Añadir elemento',
                'Track Information Content': 'Contenido de la información de la pista',
                'Scroll track information': 'Desplazar la información de la pista',
                'Hide system media controls': 'Ocultar controles multimedia del sistema',
                'Middle Click': 'Clic con el botón central',
                'View all...': 'Ver todos...',
            },
            "he": {
                "Top Bar": "הסרגל העליון",
                "Popup": "חלונית קופצת",
                "Album Art": "עטיפת האלבום",
                "Track Information": "פרטי הרצועה",
                "Playback Controls": "פקדי נגינה",
                "App Icon": "סמל היישום",
                "Blocked Apps": "יישומים חסומים",
                "Visualizer": "חזותן",
                'Add Item': 'הוספת פריט',
                'Track Information Content': 'תוכן פרטי הרצועה',
                'Scroll track information': 'גלילת פרטי הרצועה',
                'Hide system media controls': 'הסתרת פקדי המדיה של המערכת',
                'Middle Click': 'לחיצה אמצעית',
                'View all...': 'הצגת הכול...',
            },
            "it": {
                "Top Bar": "Barra superiore",
                "Popup": "Popup",
                "Album Art": "Copertina dell’album",
                "Track Information": "Informazioni del brano",
                "Playback Controls": "Controlli di riproduzione",
                "App Icon": "Icona dell’applicazione",
                "Blocked Apps": "Applicazioni bloccate",
                "Visualizer": "Visualizzatore",
                'Add Item': 'Aggiungi elemento',
                'Track Information Content': 'Contenuto delle informazioni del brano',
                'Scroll track information': 'Scorri le informazioni del brano',
                'Hide system media controls': 'Nascondi i controlli multimediali del sistema',
                'Middle Click': 'Click centrale',
                'View all...': 'Mostra tutto...',
            },
            "pt_BR": {
                "Top Bar": "Barra superior",
                "Popup": "Popup",
                "Album Art": "Capa do álbum",
                "Track Information": "Informações da faixa",
                "Playback Controls": "Controles de reprodução",
                "App Icon": "Ícone do aplicativo",
                "Blocked Apps": "Aplicativos bloqueados",
                "Visualizer": "Visualizador",
                'Add Item': 'Adicionar item',
                'Track Information Content': 'Conteúdo das informações da faixa',
                'Scroll track information': 'Rolar informações da faixa',
                'Hide system media controls': 'Ocultar controles de mídia do sistema',
                'Middle Click': 'Clique com o botão do meio',
                'View all...': 'Ver todos...',
            },
            "ru": {
                "Top Bar": "Верхняя панель",
                "Popup": "Всплывающее меню",
                "Album Art": "Обложка альбома",
                "Track Information": "Сведения о композиции",
                "Playback Controls": "Элементы управления воспроизведением",
                "App Icon": "Значок приложения",
                "Blocked Apps": "Заблокированные приложения",
                "Visualizer": "Визуализатор",
                'Add Item': 'Добавить элемент',
                'Track Information Content': 'Содержимое сведений о композиции',
                'Scroll track information': 'Прокручивать сведения о композиции',
                'Hide system media controls': 'Скрыть системные элементы управления мультимедиа',
                'Middle Click': 'Средний щелчок',
                'View all...': 'Показать всех...',
            },
            "sk": {
                "Top Bar": "Horná lišta",
                "Popup": "Vyskakovacie okno",
                "Album Art": "Obal albumu",
                "Track Information": "Informácie o skladbe",
                "Playback Controls": "Ovládacie prvky prehrávania",
                "App Icon": "Ikona aplikácie",
                "Blocked Apps": "Blokované aplikácie",
                "Visualizer": "Vizualizér",
                'Add Item': 'Pridať položku',
                'Track Information Content': 'Obsah informácií o skladbe',
                'Scroll track information': 'Posúvať informácie o skladbe',
                'Hide system media controls': 'Skryť systémové ovládanie médií',
                'Middle Click': 'Prostredné kliknutie',
                'View all...': 'Zobraziť všetko...',
            },
        }



        FORBIDDEN_SOURCE_MESSAGES = {
            "Show Visualizer",
            "About Visualizer Performance",
            "Application icon shown in the top bar",
            "Applications",
            "Clear cache",
            "Corner Radius",
            "Keyboard shortcuts",
            "Next app",
            "Next track",
            "No applications found",
            "Open app",
            "Previous track",
            "Quit app",
            "Search applications",
            "Visualizer performance",
            "Volume down",
            "Volume up",
        }


        def decode_po_string(value: str) -> str:
            try:
                return ast.literal_eval(value.strip())
            except (SyntaxError, ValueError) as error:
                raise ValueError(f"Invalid PO string literal: {value}") from error


        def parse_catalog(path: Path) -> tuple[dict[str, str], set[str], dict[str, str], dict[str, dict[int, str]]]:
            entries: dict[str, str] = {}
            fuzzy: set[str] = set()
            plural_ids: dict[str, str] = {}
            plural_translations: dict[str, dict[int, str]] = {}
            pending_flags: set[str] = set()
            current_id: list[str] | None = None
            current_plural: list[str] | None = None
            current_strings: dict[int, list[str]] = {}
            mode: tuple[str, int | None] | None = None

            def flush() -> None:
                nonlocal current_id, current_plural, current_strings, pending_flags, mode
                if current_id is None:
                    return
                msgid = "".join(current_id)
                translations = {index: "".join(parts) for index, parts in current_strings.items()}
                entries[msgid] = translations.get(0, "")
                if current_plural is not None:
                    plural_ids[msgid] = "".join(current_plural)
                    plural_translations[msgid] = translations
                if "fuzzy" in pending_flags:
                    fuzzy.add(msgid)
                current_id = None
                current_plural = None
                current_strings = {}
                pending_flags = set()
                mode = None

            for raw_line in path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if line.startswith("#,"):
                    pending_flags.update(flag.strip() for flag in line[2:].split(","))
                    continue
                if line.startswith("msgid "):
                    flush()
                    current_id = [decode_po_string(line[6:])]
                    mode = ("id", None)
                    continue
                if line.startswith("msgid_plural "):
                    if current_id is None:
                        raise ValueError(f"msgid_plural without msgid in {path}")
                    current_plural = [decode_po_string(line[13:])]
                    mode = ("plural", None)
                    continue
                plural_match = re.match(r"msgstr\[(\d+)\]\s+(.+)$", line)
                if plural_match:
                    if current_id is None:
                        raise ValueError(f"plural msgstr without msgid in {path}")
                    index = int(plural_match.group(1))
                    current_strings[index] = [decode_po_string(plural_match.group(2))]
                    mode = ("str", index)
                    continue
                if line.startswith("msgstr "):
                    if current_id is None:
                        raise ValueError(f"msgstr without msgid in {path}")
                    current_strings[0] = [decode_po_string(line[7:])]
                    mode = ("str", 0)
                    continue
                if line.startswith('"'):
                    value = decode_po_string(line)
                    if mode == ("id", None) and current_id is not None:
                        current_id.append(value)
                    elif mode == ("plural", None) and current_plural is not None:
                        current_plural.append(value)
                    elif mode is not None and mode[0] == "str":
                        current_strings.setdefault(int(mode[1]), []).append(value)
                    continue
                if not line:
                    flush()
            flush()
            return entries, fuzzy, plural_ids, plural_translations



        def validate_source_references(path: Path) -> list[str]:
            errors: list[str] = []
            referenced_paths: set[str] = set()
            for raw_line in path.read_text(encoding="utf-8").splitlines():
                if not raw_line.startswith("#:"):
                    continue
                for reference in raw_line[2:].strip().split():
                    source_path = re.sub(r":\d+(?::\d+)?$", "", reference)
                    referenced_paths.add(source_path)

            for source_path in sorted(referenced_paths):
                if not (ROOT / source_path).is_file():
                    errors.append(f"{path.name}: source reference does not exist: {source_path}")
            return errors

        def validate_header(path: Path, entries: dict[str, str], expected_language: str | None = None) -> list[str]:
            header = entries.get("", "")
            errors: list[str] = []

            if "\\n" in header:
                errors.append(
                    f"{path.name}: header contains literal \\n sequences instead of gettext newline escapes"
                )

            fields: dict[str, str] = {}
            for line in header.splitlines():
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                fields[key.strip()] = value.strip()

            content_type = fields.get("Content-Type", "")
            if not re.search(r"(?:^|;)\s*charset=UTF-8(?:\s*;|$)", content_type, re.IGNORECASE):
                errors.append(f"{path.name}: Content-Type must declare charset=UTF-8")

            if fields.get("Content-Transfer-Encoding") != "8bit":
                errors.append(f"{path.name}: Content-Transfer-Encoding must be 8bit")

            if expected_language is not None and fields.get("Language") != expected_language:
                errors.append(
                    f"{path.name}: Language header must be {expected_language!r}, "
                    f"found {fields.get('Language')!r}"
                )

            return errors


        msgfmt = shutil.which("msgfmt")
        require_native_tools = os.environ.get("MEDIASHELL_REQUIRE_NATIVE_TOOLS") == "1"
        compiled_catalog_count = 0
        if msgfmt is None and require_native_tools:
            raise SystemExit(
                "Translation contract check failed:\n"
                "- msgfmt is required when MEDIASHELL_REQUIRE_NATIVE_TOOLS=1"
            )

        pot_entries, pot_fuzzy, pot_plural_ids, _pot_plural_translations = parse_catalog(POT)
        pot_ids = set(pot_entries) - {""}
        pot_source_messages = pot_ids | set(pot_plural_ids.values())
        errors: list[str] = []
        errors.extend(validate_header(POT, pot_entries))
        errors.extend(validate_source_references(POT))

        source_ids: set[str] = set()
        js_gettext_re = re.compile(r"\b_\(\s*(\"(?:\\.|[^\"\\])*\")\s*,?\s*\)")
        js_ngettext_re = re.compile(
            r"\bngettext\(\s*(\"(?:\\.|[^\"\\])*\")\s*,\s*"
            r"(\"(?:\\.|[^\"\\])*\")\s*,"
        )
        for js_path in sorted((ROOT / "src").rglob("*.js")):
            source = js_path.read_text(encoding="utf-8")
            for literal in js_gettext_re.findall(source):
                source_ids.add(decode_po_string(literal))
            for singular_literal, plural_literal in js_ngettext_re.findall(source):
                source_ids.add(decode_po_string(singular_literal))
                source_ids.add(decode_po_string(plural_literal))

        for ui_path in sorted((ROOT / "assets" / "ui").glob("*.ui")):
            for node in ET.parse(ui_path).iter():
                if node.get("translatable") == "yes" and node.text:
                    source_ids.add(node.text)

        missing_from_template = sorted(source_ids - pot_source_messages)
        stale_in_template = sorted(pot_source_messages - source_ids)
        if missing_from_template:
            errors.append(f"Template is missing {len(missing_from_template)} source messages: {missing_from_template}")
        if stale_in_template:
            errors.append(f"Template contains {len(stale_in_template)} stale messages: {stale_in_template}")
        if pot_fuzzy - {""}:
            errors.append(f"Template contains fuzzy messages: {sorted(pot_fuzzy - {''})}")

        for forbidden_message in sorted(FORBIDDEN_SOURCE_MESSAGES & pot_source_messages):
            errors.append(f"Template contains obsolete visible text: {forbidden_message!r}")

        for po_path in sorted(LOCALE_DIR.glob("*.po")):
            entries, fuzzy, plural_ids, plural_translations = parse_catalog(po_path)
            errors.extend(validate_header(po_path, entries, po_path.stem))
            errors.extend(validate_source_references(po_path))
            ids = set(entries) - {""}
            missing = sorted(pot_ids - ids)
            plural_mismatches = sorted(
                msgid for msgid in pot_ids
                if plural_ids.get(msgid) != pot_plural_ids.get(msgid)
            )
            obsolete = sorted(ids - pot_ids)
            untranslated = sorted(
                msgid for msgid in pot_ids
                if msgid not in pot_plural_ids and not entries.get(msgid)
            )
            untranslated_plurals = sorted(
                msgid for msgid in pot_plural_ids
                if not plural_translations.get(msgid)
                or any(not translation for translation in plural_translations[msgid].values())
            )
            fuzzy_messages = sorted(fuzzy - {""})

            if missing:
                errors.append(f"{po_path.name}: missing {len(missing)} messages: {missing}")
            if obsolete:
                errors.append(f"{po_path.name}: contains {len(obsolete)} obsolete messages: {obsolete}")
            if plural_mismatches:
                errors.append(f"{po_path.name}: plural source mismatch for: {plural_mismatches}")
            if untranslated:
                errors.append(f"{po_path.name}: contains {len(untranslated)} untranslated messages: {untranslated}")
            if untranslated_plurals:
                errors.append(f"{po_path.name}: contains untranslated plural messages: {untranslated_plurals}")
            if fuzzy_messages:
                errors.append(f"{po_path.name}: contains fuzzy messages: {fuzzy_messages}")

            expected_terms = CANONICAL_TERMS.get(po_path.stem, {})
            for msgid, expected_translation in expected_terms.items():
                actual_translation = entries.get(msgid)
                if actual_translation != expected_translation:
                    errors.append(
                        f"{po_path.name}: canonical translation for {msgid!r} must be "
                        f"{expected_translation!r}, found {actual_translation!r}"
                    )


            casefold_groups: dict[str, list[str]] = {}
            for msgid in pot_ids:
                casefold_groups.setdefault(msgid.casefold(), []).append(msgid)
            for source_messages in casefold_groups.values():
                if len(source_messages) < 2:
                    continue
                translations = {entries.get(msgid) for msgid in source_messages}
                if len(translations) > 1:
                    errors.append(
                        f"{po_path.name}: source messages that differ only by UI-role capitalization "
                        f"must share one natural translation: {sorted(source_messages)!r} -> "
                        f"{sorted(translations)!r}"
                    )

            for msgid in sorted(pot_ids & ids):
                if msgid in pot_plural_ids:
                    expected_by_form = [
                        PLACEHOLDER_RE.findall(msgid),
                        PLACEHOLDER_RE.findall(pot_plural_ids[msgid]),
                    ]
                    for index, translation in sorted(plural_translations.get(msgid, {}).items()):
                        expected = expected_by_form[0 if index == 0 else 1]
                        actual = PLACEHOLDER_RE.findall(translation)
                        if sorted(expected) != sorted(actual):
                            errors.append(
                                f"{po_path.name}: placeholder mismatch for {msgid!r} plural form {index}: "
                                f"expected {expected}, found {actual}"
                            )
                    continue
                expected = PLACEHOLDER_RE.findall(msgid)
                actual = PLACEHOLDER_RE.findall(entries[msgid])
                if sorted(expected) != sorted(actual):
                    errors.append(
                        f"{po_path.name}: placeholder mismatch for {msgid!r}: expected {expected}, found {actual}"
                    )

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
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                    )
                    if result.returncode != 0:
                        errors.append(f"{po_path.name}: msgfmt failed: {result.stderr.strip()}")
                    elif not output_path.is_file() or output_path.stat().st_size == 0:
                        errors.append(f"{po_path.name}: msgfmt produced an empty catalog")
                    else:
                        compiled_catalog_count += 1

        if errors:
            raise SystemExit("Translation contract check failed:\n" + "\n".join(f"- {error}" for error in errors))

        print(
            f"Translation contract check passed: {len(pot_ids)} messages in "
            f"{len(list(LOCALE_DIR.glob('*.po')))} locales; "
            f"{compiled_catalog_count} catalogs compiled with msgfmt."
        )

    check_translations()


if __name__ == "__main__":
    main()
