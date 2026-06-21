// Runs the maintained MediaShell validation suite without enforcing prose style or repository trivia.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PREFERENCE_WIDGET_BINDINGS } from "../src/prefs/bindings/PreferenceBindings.js";
import { INPUT_ACTION_DEFINITIONS, KEYBOARD_SHORTCUT_KEYS } from "../src/shared/constants/inputActions.js";
import { SUPPORTED_GNOME_SHELL_VERSIONS } from "../src/shared/constants/platform.js";
import {
    INPUT_SETTING_KEY_MIGRATIONS,
    LEGACY_SETTING_KEY_MIGRATIONS,
    NAMING_SETTING_KEY_MIGRATIONS,
    PLACEMENT_SETTING_KEY_MIGRATIONS,
    SETTINGS_SCHEMA_VERSION,
    SHORTCUT_SETTING_KEY_MIGRATIONS,
} from "../src/shared/settings/SettingsMigration.js";
import { SETTINGS_SPEC } from "../src/shell/settings/SettingsSpec.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const IGNORED_DIRECTORIES = new Set([".git", "dist", "node_modules", "__pycache__"]);

function rootPath(path) {
    return join(ROOT, path);
}

async function read(path) {
    return readFile(rootPath(path), "utf8");
}

async function exists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function isFile(path) {
    try {
        return (await stat(path)).isFile();
    } catch {
        return false;
    }
}

async function collect(directory, include) {
    const absoluteDirectory = rootPath(directory);
    const files = [];

    for (const entry of await readdir(absoluteDirectory, { withFileTypes: true })) {
        if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;

        const path = join(directory, entry.name).replaceAll("\\", "/");
        if (entry.isDirectory()) files.push(...(await collect(path, include)));
        else if (include(path)) files.push(path);
    }

    return files.sort();
}

function fail(label, errors) {
    if (errors.length === 0) return;

    console.error(`${label} failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    process.exit(1);
}

function runCommand(label, command, args) {
    console.log(`\n==> ${label}`);
    const result = spawnSync(command, args, {
        cwd: ROOT,
        env: process.env,
        stdio: "inherit",
    });

    if (result.error) {
        console.error(`${label} could not start: ${result.error.message}`);
        process.exit(1);
    }
    if (result.status !== 0) process.exit(result.status ?? 1);
}

// Verifies that maintained JavaScript modules parse with the repository Node.js baseline.
async function checkSyntax() {
    const files = [
        ...(await collect("src", (path) => extname(path) === ".js")),
        ...(await collect("scripts", (path) => [".js", ".mjs"].includes(extname(path)))),
        ...(await collect("tests", (path) => [".js", ".mjs"].includes(extname(path)))),
    ];

    for (const file of files) {
        const result = spawnSync(process.execPath, ["--check", rootPath(file)], { stdio: "inherit" });
        if (result.status !== 0) process.exit(result.status ?? 1);
    }

    console.log(`JavaScript syntax passed for ${files.length} modules.`);
}

// Verifies relative imports, circular dependencies, and Shell/Preferences/Shared boundaries.
async function checkImports() {
    const files = await collect("src", (path) => extname(path) === ".js");
    const absoluteFiles = new Set(files.map((file) => resolve(rootPath(file))));
    const dependencyGraph = new Map([...absoluteFiles].map((file) => [file, []]));
    const importPattern = /(?:\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?|\bimport\s*\()(["'])([^"']+)\1/g;
    const errors = [];

    for (const file of files) {
        const source = await read(file);
        const normalizedFile = file.replaceAll("\\", "/");
        const absoluteFile = resolve(rootPath(file));

        for (const match of source.matchAll(importPattern)) {
            const specifier = match[2];
            if (!specifier.startsWith(".")) continue;

            const target = normalize(resolve(dirname(absoluteFile), specifier));
            if (!(await isFile(target))) errors.push(`${file}: missing relative import ${specifier}`);
            else if (absoluteFiles.has(target)) dependencyGraph.get(absoluteFile).push(target);
        }

        if (/\b(?:const|let|var)\s+imports\b|\bimports\.(?:ui|misc|gi)\b/.test(source))
            errors.push(`${file}: legacy GJS imports are not allowed`);

        if (normalizedFile.startsWith("src/shared/") && /from\s+["'](?:gi|resource):/.test(source))
            errors.push(`${file}: shared modules must remain independent of GNOME runtime APIs`);

        if (normalizedFile === "src/prefs.js" || normalizedFile.startsWith("src/prefs/")) {
            if (
                /resource:\/\/\/org\/gnome\/shell\/ui\//.test(source) ||
                /gi:\/\/(?:St|Clutter|Shell|Meta)(?:\?|["'])/.test(source)
            ) {
                errors.push(`${file}: preferences code imports a Shell-only API`);
            }
        }

        if (normalizedFile === "src/extension.js" || normalizedFile.startsWith("src/shell/")) {
            if (
                /gi:\/\/(?:Gtk|Adw|Gdk|Graphene)(?:\?|["'])/.test(source) ||
                /org\/gnome\/Shell\/Extensions\/js\/extensions\/prefs\.js/.test(source)
            ) {
                errors.push(`${file}: Shell code imports a Preferences-only API`);
            }
        }
    }

    const visiting = new Set();
    const visited = new Set();

    function visit(file, stack = []) {
        if (visiting.has(file)) {
            const cycleStart = stack.indexOf(file);
            const cycle = [...stack.slice(cycleStart), file].map((entry) => relative(ROOT, entry));
            errors.push(`circular relative import: ${cycle.join(" -> ")}`);
            return;
        }
        if (visited.has(file)) return;

        visiting.add(file);
        stack.push(file);
        for (const dependency of dependencyGraph.get(file) ?? []) visit(dependency, stack);
        stack.pop();
        visiting.delete(file);
        visited.add(file);
    }

    for (const file of dependencyGraph.keys()) visit(file);

    fail("Import and process-boundary validation", errors);
    console.log(`Import and process boundaries passed for ${files.length} source modules.`);
}

// Verifies compatibility declarations against their executable sources of truth.
async function checkCompatibility() {
    const metadata = JSON.parse(await read("src/metadata.json"));
    const packageJson = JSON.parse(await read("package.json"));
    const prefsEntry = await read("src/prefs.js");
    const errors = [];

    if (JSON.stringify(metadata["shell-version"]) !== JSON.stringify(SUPPORTED_GNOME_SHELL_VERSIONS))
        errors.push("metadata.json shell-version differs from src/shared/constants/platform.js");
    if (metadata["version-name"] !== packageJson.version)
        errors.push("package.json version differs from metadata.json version-name");
    if (!/import Adw from "gi:\/\/Adw"/.test(prefsEntry))
        errors.push("src/prefs.js does not import Libadwaita");
    if (!/isVersionAtLeast/.test(prefsEntry) || !/assertSupportedLibadwaita\(\)/.test(prefsEntry))
        errors.push("src/prefs.js does not enforce the shared Libadwaita compatibility guard");

    fail("Compatibility validation", errors);
    console.log("Compatibility declarations match runtime guards.");
}

// Verifies version-sensitive GNOME Shell API usage across maintained source files.
async function checkGnomeShellCompatibility() {
    const files = [
        ...(await collect("src", (path) => extname(path) === ".js" || path.endsWith("metadata.json"))),
        ...(await collect("assets", (path) => [".xml", ".ui"].includes(extname(path)))),
    ];
    const errors = [];

    const forbiddenPatterns = [
        [
            /\bClutter\.(?:ClickAction|TapAction)\b/,
            "removed Clutter action class; use ClickGesture or an isolated event fallback",
        ],
        [
            /\bvertical\s*:/,
            "deprecated St vertical property; use orientation with Clutter.Orientation",
        ],
        [/\bExtensionUtils\b|imports\.(?:ui|misc|gi)\b/, "legacy extension imports are not allowed"],
    ];

    for (const file of files) {
        const text = await read(file);
        for (const [pattern, description] of forbiddenPatterns) {
            if (pattern.test(text)) errors.push(`${file}: ${description}`);
        }
    }

    fail("GNOME Shell compatibility validation", errors);
    console.log("GNOME Shell compatibility rules passed.");
}

// Verifies review-sensitive lifecycle and generated-artifact rules in the maintained source tree.
async function checkGnomeReviewRules() {
    const files = [
        ...(await collect("src", (path) => extname(path) === ".js" || path.endsWith("metadata.json"))),
        ...(await collect("assets", (path) => [".xml", ".ui"].includes(extname(path)))),
    ];
    const prefsEntry = await read("src/prefs.js");
    const errors = [];

    const forbiddenPatterns = [
        [/\brun_dispose\s*\(/, "manual run_dispose usage"],
        [/gschemas\.compiled/, "compiled GSettings schemas must not be shipped or referenced"],
    ];

    for (const file of files) {
        const text = await read(file);
        for (const [pattern, description] of forbiddenPatterns) {
            if (pattern.test(text)) errors.push(`${file}: ${description}`);
        }
    }

    if (/this\.preferencesController\b/.test(prefsEntry))
        errors.push("src/prefs.js stores a window-scoped PreferencesController on the exported class");

    fail("GNOME Shell review validation", errors);
    console.log("GNOME Shell review rules passed.");
}

// Verifies MediaShell-specific release invariants that are intentionally project-owned.
async function checkMediaShellInvariants() {
    const metadata = JSON.parse(await read("src/metadata.json"));
    const errors = [];

    if (!metadata.donations?.buymeacoffee)
        errors.push("metadata.json must keep the Buy Me a Coffee donation metadata for EGO");
    if (!(await exists(rootPath("src/icons/hicolor/scalable/apps/mediashell.svg"))))
        errors.push("application icon is missing from src/icons/hicolor/scalable/apps/mediashell.svg");

    fail("MediaShell invariant validation", errors);
    console.log("MediaShell project invariants passed.");
}

// Verifies release packaging configuration before the package is built.
async function checkPackagingConfiguration() {
    const packageJson = JSON.parse(await read("package.json"));
    const resourceManifest = await read("assets/org.gnome.shell.extensions.mediashell.gresource.xml");
    const errors = [];

    const packCommand = packageJson.scripts?.["build:pack"] ?? "";
    if (!packCommand.includes("--extra-source=icons"))
        errors.push("build:pack must include the hicolor application icon directory");
    for (const forbiddenSource of ["assets", "docs", "tests", "node_modules", "dist"])
        if (packCommand.includes(`--extra-source=${forbiddenSource}`))
            errors.push(`build:pack must not ship ${forbiddenSource} as an extra source`);

    if (/images\//.test(resourceManifest) || /locale\//.test(resourceManifest))
        errors.push("GResource manifest must not bundle screenshots or gettext catalogs");

    if (!packageJson.scripts?.["check:package"]?.includes("scripts/check-package.mjs"))
        errors.push("package.json must expose scripts/check-package.mjs as check:package");
    if (!packageJson.scripts?.build?.includes("pnpm run check:package"))
        errors.push("build script must validate the generated extension package");

    fail("Packaging configuration validation", errors);
    console.log("Packaging configuration passed.");
}

function parseSchemaKeys(schema) {
    return new Set([...schema.matchAll(/<key\s+name="([^"]+)"/g)].map((match) => match[1]));
}

function parseSchemaVersionMaximum(schema) {
    const match = schema.match(
        /<key\s+name="settings-schema-version"[\s\S]*?<range\s+min="\d+"\s+max="(\d+)"/,
    );
    return match ? Number(match[1]) : null;
}

// Verifies that runtime settings, Preferences bindings, shortcuts, and migrations target real schema keys.
async function checkSettings() {
    const schema = await read("assets/org.gnome.shell.extensions.mediashell.gschema.xml");
    const schemaKeys = parseSchemaKeys(schema);
    const sourceFiles = await collect("src", (path) => extname(path) === ".js");
    const source = (await Promise.all(sourceFiles.map(read))).join("\n");
    const errors = [];

    const runtimeKeys = Object.keys(SETTINGS_SPEC);
    const preferenceKeys = PREFERENCE_WIDGET_BINDINGS.map(([key]) => key);
    const migrationMaps = [
        LEGACY_SETTING_KEY_MIGRATIONS,
        NAMING_SETTING_KEY_MIGRATIONS,
        PLACEMENT_SETTING_KEY_MIGRATIONS,
        SHORTCUT_SETTING_KEY_MIGRATIONS,
        INPUT_SETTING_KEY_MIGRATIONS,
    ];

    for (const key of new Set([...runtimeKeys, ...preferenceKeys, ...KEYBOARD_SHORTCUT_KEYS])) {
        if (!schemaKeys.has(key)) errors.push(`code references missing schema key: ${key}`);
    }

    for (const migrations of migrationMaps) {
        for (const [sourceKey, destinationKey] of Object.entries(migrations)) {
            if (!schemaKeys.has(sourceKey)) errors.push(`migration source is missing from schema: ${sourceKey}`);
            if (!schemaKeys.has(destinationKey)) errors.push(`migration destination is missing from schema: ${destinationKey}`);
        }
    }

    for (const key of schemaKeys) {
        if (!source.includes(`"${key}"`) && !source.includes(`'${key}'`))
            errors.push(`schema key is not referenced by maintained source: ${key}`);
    }

    const schemaVersionMaximum = parseSchemaVersionMaximum(schema);
    if (schemaVersionMaximum !== SETTINGS_SCHEMA_VERSION)
        errors.push("settings-schema-version range does not match SETTINGS_SCHEMA_VERSION");

    const actionIds = INPUT_ACTION_DEFINITIONS.map(({ id }) => id);
    if (new Set(actionIds).size !== actionIds.length) errors.push("input action IDs are not unique");
    if (new Set(KEYBOARD_SHORTCUT_KEYS).size !== KEYBOARD_SHORTCUT_KEYS.length)
        errors.push("keyboard shortcut keys are not unique");

    fail("Settings validation", errors);
    console.log(`Settings validation passed for ${schemaKeys.size} schema keys.`);
}

// Verifies only structural package references that can cause builds or commands to fail.
async function checkProjectReferences() {
    const packageJson = JSON.parse(await read("package.json"));
    const metadata = JSON.parse(await read("src/metadata.json"));
    const schema = await read("assets/org.gnome.shell.extensions.mediashell.gschema.xml");
    const errors = [];

    for (const path of [
        "src/extension.js",
        "src/prefs.js",
        "src/metadata.json",
        "src/stylesheet.css",
        "assets/org.gnome.shell.extensions.mediashell.gschema.xml",
        "assets/org.gnome.shell.extensions.mediashell.gresource.xml",
    ]) {
        if (!(await exists(rootPath(path)))) errors.push(`required project entry point is missing: ${path}`);
    }

    for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
        for (const match of command.matchAll(/(?:^|[\s"'])(scripts\/[\w./-]+)/g)) {
            const scriptPath = match[1];
            if (!(await exists(rootPath(scriptPath)))) errors.push(`package script ${name} references missing ${scriptPath}`);
        }
    }

    const schemaId = schema.match(/<schema\s+id="([^"]+)"/)?.[1];
    if (schemaId !== metadata["settings-schema"])
        errors.push("metadata settings-schema differs from the compiled schema ID");
    if (metadata.uuid !== `${metadata["gettext-domain"]}`)
        errors.push("metadata uuid and gettext-domain differ");

    fail("Project reference validation", errors);
    console.log("Project entry points and package script references are valid.");
}

function stripLinkSuffix(target) {
    return target.split("#", 1)[0].split("?", 1)[0];
}

// Verifies documentation links, referenced paths, package commands, and duplicate headings.
async function checkDocumentation() {
    const documentationFiles = [
        "README.md",
        ...((await exists(rootPath("CONTRIBUTING.md"))) ? ["CONTRIBUTING.md"] : []),
        ...(await collect("docs", (path) => extname(path) === ".md")),
        ...(await collect(".github/ISSUE_TEMPLATE", (path) => extname(path) === ".md")),
    ];
    const packageJson = JSON.parse(await read("package.json"));
    const errors = [];

    for (const file of documentationFiles) {
        const text = await read(file);
        const base = dirname(rootPath(file));
        const headings = new Set();

        for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
            const heading = match[1].trim().toLocaleLowerCase("en-US");
            if (headings.has(heading)) errors.push(`${file}: duplicate heading ${match[1].trim()}`);
            headings.add(heading);
        }

        for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
            const rawTarget = match[1].trim().replace(/^<|>$/g, "");
            if (!rawTarget || /^(?:https?:|mailto:|#)/.test(rawTarget)) continue;

            const target = stripLinkSuffix(rawTarget);
            if (!target) continue;
            if (!(await exists(resolve(base, decodeURIComponent(target)))))
                errors.push(`${file}: broken relative link ${rawTarget}`);
        }

        for (const match of text.matchAll(/`((?:src|assets|scripts|docs|tests|\.github)\/[^`\n]+)`/g)) {
            let documentedPath = match[1].trim().replace(/[),.;:]+$/, "");
            if (documentedPath.includes(" ") || documentedPath.includes("${")) continue;
            if (documentedPath.includes("*")) documentedPath = dirname(documentedPath);
            if (!(await exists(rootPath(documentedPath))))
                errors.push(`${file}: documented path does not exist: ${match[1]}`);
        }

        for (const match of text.matchAll(/(?:^|`)pnpm(?:\s+run)?\s+([a-zA-Z][\w:-]*)/gm)) {
            const command = match[1];
            if (["install", "exec", "dlx", "add", "remove", "update"].includes(command)) continue;
            if (!(command in (packageJson.scripts ?? {}))) errors.push(`${file}: unknown pnpm script ${command}`);
        }

        // Reject volatile inventory claims, not prose style or wording choices.
        if (/~\s*\d|\bapproximately\b|\b(?:has|uses|contains)\s+\d+\s+(?:files?|lines?|directories|documents?|runtimes?|dependencies|packages?)\b/i.test(text))
            errors.push(`${file}: contains a transient size or inventory claim`);
    }

    fail("Documentation validation", errors);
    console.log(`Documentation links and references passed for ${documentationFiles.length} files.`);
}

const checks = [
    ["JavaScript syntax", checkSyntax],
    ["imports and process boundaries", checkImports],
    ["compatibility declarations", checkCompatibility],
    ["GNOME Shell compatibility", checkGnomeShellCompatibility],
    ["GNOME Shell review rules", checkGnomeReviewRules],
    ["MediaShell project invariants", checkMediaShellInvariants],
    ["packaging configuration", checkPackagingConfiguration],
    ["settings and migrations", checkSettings],
    ["project references", checkProjectReferences],
    ["documentation", checkDocumentation],
];

for (const [label, check] of checks) {
    console.log(`\n==> ${label}`);
    await check();
}

runCommand("unit tests", process.execPath, ["--test"]);
runCommand("resources, schema, and translations", "python3", ["scripts/check-assets.py"]);
runCommand("development script syntax", "bash", ["-n", "scripts/development.sh"]);

console.log(`\nAll ${checks.length + 3} validation groups passed.`);
