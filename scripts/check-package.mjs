// Validates the generated GNOME Shell extension package before release or upload.

import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEFAULT_PACKAGE = "dist/builds/mediashell@wstxda.github.com.shell-extension.zip";
const packagePath = process.argv[2] ?? join(ROOT, DEFAULT_PACKAGE);

async function exists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

function fail(errors) {
    if (errors.length === 0) return;

    console.error(`Package validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    process.exit(1);
}

function readZip(path) {
    const script = String.raw`
import json
import sys
import zipfile

archive = sys.argv[1]
entries = []
contents = {}
text_suffixes = (".js", ".json", ".xml", ".ui", ".css", ".txt", ".md")

with zipfile.ZipFile(archive) as zf:
    for info in zf.infolist():
        name = info.filename
        entries.append({"name": name, "size": info.file_size, "is_dir": name.endswith("/")})
        if not name.endswith("/") and name.endswith(text_suffixes) and info.file_size <= 1024 * 1024:
            try:
                contents[name] = zf.read(info).decode("utf-8")
            except UnicodeDecodeError:
                pass

print(json.dumps({"entries": entries, "contents": contents}))
`;

    const result = spawnSync("python3", ["-c", script, path], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || "python3 zipfile validation failed");
    }

    return JSON.parse(result.stdout);
}

function validateArchiveShape(entries) {
    const errors = [];
    const names = entries.map(({ name }) => name);
    const uniqueNames = new Set(names);

    if (uniqueNames.size !== names.length) errors.push("archive contains duplicate entries");

    for (const name of names) {
        if (name.startsWith("/") || name.includes("../") || name.startsWith("../"))
            errors.push(`${name}: unsafe archive path`);
    }

    return errors;
}

function validateRequiredRuntimeEntries(entrySet, metadata) {
    const errors = [];
    const schemaName = metadata?.["settings-schema"] ?? "org.gnome.shell.extensions.mediashell";
    const requiredEntries = [
        "metadata.json",
        "extension.js",
        "prefs.js",
        "stylesheet.css",
        "org.gnome.shell.extensions.mediashell.gresource",
        `schemas/${schemaName}.gschema.xml`,
        "icons/hicolor/scalable/apps/mediashell.svg",
        "shell/ExtensionController.js",
        "prefs/PreferencesController.js",
        "shared/constants/platform.js",
    ];

    for (const entry of requiredEntries) {
        if (!entrySet.has(entry)) errors.push(`missing runtime entry: ${entry}`);
    }

    return errors;
}

function validateForbiddenEntries(entries) {
    const errors = [];
    const forbiddenPatterns = [
        [/^(?:assets|docs|tests|node_modules|dist|\.github)(?:\/|$)/, "repository-only directory must not be shipped"],
        [/(?:^|\/)(?:README|CONTRIBUTING|package|pnpm-lock)\.(?:md|json|yaml|yml)$/, "repository metadata must not be shipped"],
        [/(?:^|\/)gschemas\.compiled$/, "compiled GSettings schemas must not be shipped"],
        [/\.po(?:~)?$|\.pot$/, "source gettext catalogs must not be shipped"],
        [/(?:^|\/)(?:screenshots?|store-assets?)(?:\/|$)/, "store screenshots must not be shipped"],
        [/(?:^|\/)screen_[^/]+\.png$/, "store screenshot image must not be shipped"],
        [/(?:^|\/)icon\.png$/, "store raster icon must not be shipped"],
    ];

    for (const { name, is_dir } of entries) {
        if (is_dir) continue;
        for (const [pattern, description] of forbiddenPatterns) {
            if (pattern.test(name)) errors.push(`${name}: ${description}`);
        }
    }

    return errors;
}

function validateTextContents(contents) {
    const errors = [];
    const forbiddenPatterns = [
        [/\bClutter\.(?:ClickAction|TapAction)\b/, "removed Clutter action class"],
        [/\bvertical\s*:/, "deprecated St vertical property"],
        [/\bExtensionUtils\b|imports\.(?:ui|misc|gi)\b/, "legacy imports or ExtensionUtils usage"],
        [/\brun_dispose\s*\(/, "manual run_dispose usage"],
        [/gschemas\.compiled/, "compiled GSettings schema reference"],
    ];

    for (const [name, text] of Object.entries(contents)) {
        for (const [pattern, description] of forbiddenPatterns) {
            if (pattern.test(text)) errors.push(`${name}: ${description}`);
        }
    }

    return errors;
}

if (!(await exists(packagePath))) {
    console.error(`Package validation failed:\n- package not found: ${packagePath}`);
    process.exit(1);
}

let archive;
try {
    archive = readZip(packagePath);
} catch (error) {
    console.error(`Package validation failed:\n- could not inspect package: ${error.message}`);
    process.exit(1);
}

const entries = archive.entries;
const entrySet = new Set(entries.map(({ name }) => name));
let metadata = null;
const errors = [];

if (archive.contents["metadata.json"]) {
    try {
        metadata = JSON.parse(archive.contents["metadata.json"]);
    } catch (error) {
        errors.push(`metadata.json is not valid JSON: ${error.message}`);
    }
} else {
    errors.push("metadata.json is missing");
}

errors.push(...validateArchiveShape(entries));
errors.push(...validateRequiredRuntimeEntries(entrySet, metadata));
errors.push(...validateForbiddenEntries(entries));
errors.push(...validateTextContents(archive.contents));

fail(errors);
console.log(`Package validation passed for ${entries.filter(({ is_dir }) => !is_dir).length} runtime files.`);
