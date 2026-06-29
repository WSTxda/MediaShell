/**
 * @file check.mjs
 * @module scripts.check
 *
 * Validates the repository contracts that are practical to check without running GNOME Shell.
 *
 * The script focuses on source syntax, import boundaries, extension metadata,
 * settings/schema alignment, repository references, naming regressions, tests,
 * resources, and translation integrity. Package validation is available through
 * `--package` so release archives can be inspected with the same contract set.
 */

import { spawnSync } from "node:child_process";
import { access, readFile, readdir, stat } from "node:fs/promises";
import {
  dirname,
  extname,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

import { PREFERENCE_WIDGET_BINDINGS } from "../src/prefs/bindings/PreferenceBindings.js";
import {
  INPUT_ACTION_DEFINITIONS,
  KEYBOARD_SHORTCUT_KEYS,
} from "../src/shared/constants/inputActions.js";
import { SUPPORTED_GNOME_SHELL_VERSIONS } from "../src/shared/constants/platform.js";
import { SETTINGS_SPEC } from "../src/shell/settings/SettingsSpec.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const EXTENSION_UUID = "mediashell@wstxda.github.com";
const EXTENSION_PACKAGE = `dist/builds/${EXTENSION_UUID}.shell-extension.zip`;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "dist",
  "node_modules",
  "__pycache__",
]);

const FORBIDDEN_API_PATTERNS = [
  {
    pattern: /\bClutter\.(?:ClickAction|TapAction)\b/,
    description:
      "removed Clutter action class; use ClickGesture or an isolated event fallback",
  },
  {
    pattern: /\bvertical\s*:/,
    description:
      "deprecated St vertical property; use orientation with Clutter.Orientation",
  },
  {
    pattern: /\bExtensionUtils\b|imports\.(?:ui|misc|gi)\b/,
    description: "legacy GJS imports; use gi:// and resource:// URIs instead",
  },
  {
    pattern: /\brun_dispose\s*\(/,
    description:
      "manual run_dispose() is unsafe; let GObject handle destruction through normal ownership",
  },
  {
    pattern: /gschemas\.compiled/,
    description: "compiled GSettings schemas must not be shipped or referenced",
  },
];

function rootPath(path) {
  return join(ROOT, path);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function read(path) {
  return readFile(rootPath(path), "utf8");
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function collect(directory, include) {
  const files = [];

  for (const entry of await readdir(rootPath(directory), {
    withFileTypes: true,
  })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;

    const path = join(directory, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) files.push(...(await collect(path, include)));
    else if (include(path)) files.push(path);
  }

  return files.sort();
}

function fail(label, errors) {
  if (errors.length === 0) return;

  console.error(
    `${label} failed:\n${errors.map((error) => `- ${error}`).join("\n")}`,
  );
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

async function checkSyntax() {
  const files = [
    ...(await collect("src", (path) => extname(path) === ".js")),
    ...(await collect("scripts", (path) =>
      [".js", ".mjs"].includes(extname(path)),
    )),
    ...(await collect("tests", (path) =>
      [".js", ".mjs"].includes(extname(path)),
    )),
  ];

  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", rootPath(file)], {
      stdio: "inherit",
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }

  console.log(`JavaScript syntax passed for ${files.length} modules.`);
}

async function checkModuleDocumentation() {
  const files = [
    ...(await collect("src", (path) => extname(path) === ".js")),
    ...(await collect("scripts", (path) =>
      [".js", ".mjs"].includes(extname(path)),
    )),
    ...(await collect("tests", (path) =>
      [".js", ".mjs"].includes(extname(path)),
    )),
  ];
  const errors = [];

  for (const file of files) {
    const text = await read(file);
    const header = text.match(/^\/\*\*[\s\S]*?\*\//)?.[0] ?? "";
    const expectedFile = file.split("/").at(-1);

    if (!header) {
      errors.push(`${file}: missing module header`);
      continue;
    }
    if (!header.includes(`@file ${expectedFile}`))
      errors.push(`${file}: module header has no matching @file`);
    if (!/@module\s+[A-Za-z0-9_.-]+/.test(header))
      errors.push(`${file}: module header has no @module name`);

    const proseLines = header
      .split("\n")
      .map((line) => line.replace(/^\s*\* ?/, "").trim())
      .filter((line) => line && !line.startsWith("/") && !line.startsWith("@"));
    if (proseLines.length < 2)
      errors.push(
        `${file}: module header must describe responsibility and purpose`,
      );

    if (file.startsWith("src/")) {
      const lines = text.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        if (
          !/^(?:export\s+default\s+class|export\s+class|class)\s+[A-Za-z0-9_]+\b/.test(
            lines[index],
          )
        )
          continue;

        let previous = index - 1;
        while (previous >= 0 && lines[previous].trim() === "") previous -= 1;
        if (previous < 0 || !lines[previous].trim().endsWith("*/"))
          errors.push(
            `${file}:${index + 1}: class declaration must have a compact JSDoc comment`,
          );
      }
    }
  }

  fail("Module documentation validation", errors);
  console.log("Module documentation passed.");
}

function extractClassBodies(source) {
  const classBodies = [];
  const classPattern =
    /(?:^|\n)\s*(?:export\s+default\s+class|export\s+class|class)\s+([A-Za-z0-9_]+)\b[^\{]*\{/g;

  for (const match of source.matchAll(classPattern)) {
    const className = match[1];
    const bodyStart = match.index + match[0].lastIndexOf("{");
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
      const character = source[index];
      if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          classBodies.push({
            className,
            body: source.slice(bodyStart + 1, index),
          });
          break;
        }
      }
    }
  }

  return classBodies;
}

function classMethodNames(classBody) {
  const methods = [];
  const lines = classBody.split("\n");
  let depth = 1;

  for (const line of lines) {
    const match =
      depth === 1
        ? line.match(/^\s{4}(?:async\s+)?([A-Za-z_][\w]*)\s*\(/)
        : null;
    if (
      match &&
      !["if", "for", "while", "switch", "catch", "return"].includes(match[1])
    )
      methods.push(match[1]);

    for (const character of line) {
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
    }
  }

  return methods;
}

async function checkClassLifecycleOrder() {
  const files = await collect("src", (path) => extname(path) === ".js");
  const errors = [];

  for (const file of files) {
    const source = await read(file);
    for (const { className, body } of extractClassBodies(source)) {
      const methods = classMethodNames(body);
      const destroyIndex = methods.indexOf("destroy");
      if (destroyIndex >= 0 && destroyIndex !== methods.length - 1) {
        const afterDestroy = methods.slice(destroyIndex + 1).join(", ");
        errors.push(
          `${file}: ${className}.destroy() must be the final class method; found after it: ${afterDestroy}`,
        );
      }
    }
  }

  fail("Class lifecycle ordering validation", errors);
  console.log("Class lifecycle ordering passed.");
}

function parseImportStatements(source) {
  const statements = [];
  const importPattern = /^import\s[\s\S]*?;$/gm;

  for (const match of source.matchAll(importPattern)) {
    const statement = match[0];
    const specifier =
      statement.match(
        /from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/,
      )?.[1] ??
      statement.match(/from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/)?.[2];
    if (!specifier) continue;
    statements.push({
      specifier,
      isRelative: specifier.startsWith("."),
      line: source.slice(0, match.index).split("\n").length,
    });
  }

  return statements;
}

async function checkImportsAndBoundaries() {
  const files = await collect("src", (path) => extname(path) === ".js");
  const absoluteFiles = new Set(files.map((file) => resolve(rootPath(file))));
  const dependencyGraph = new Map([...absoluteFiles].map((file) => [file, []]));
  const importPattern =
    /(?:\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?|\bimport\s*\()(["'])([^"']+)\1/g;
  const errors = [];

  for (const file of files) {
    const source = await read(file);
    const normalizedFile = file.replaceAll("\\", "/");
    const absoluteFile = resolve(rootPath(file));
    let sawRelativeImport = false;
    for (const { isRelative, specifier, line } of parseImportStatements(
      source,
    )) {
      if (isRelative) sawRelativeImport = true;
      else if (sawRelativeImport)
        errors.push(
          `${file}:${line}: external import ${specifier} appears after a relative import`,
        );
    }

    for (const match of source.matchAll(importPattern)) {
      const specifier = match[2];
      if (!specifier.startsWith(".")) continue;

      const target = normalize(resolve(dirname(absoluteFile), specifier));
      if (!(await isFile(target)))
        errors.push(`${file}: missing relative import ${specifier}`);
      else if (absoluteFiles.has(target))
        dependencyGraph.get(absoluteFile).push(target);
    }

    if (
      /\b(?:const|let|var)\s+imports\b|\bimports\.(?:ui|misc|gi)\b/.test(source)
    )
      errors.push(`${file}: legacy GJS imports are not allowed`);

    if (
      normalizedFile.startsWith("src/shared/") &&
      /from\s+["'](?:gi|resource):/.test(source)
    )
      errors.push(
        `${file}: shared modules must remain independent of GNOME runtime APIs`,
      );

    if (
      normalizedFile === "src/prefs.js" ||
      normalizedFile.startsWith("src/prefs/")
    ) {
      if (
        /resource:\/\/\/org\/gnome\/shell\/ui\//.test(source) ||
        /gi:\/\/(?:St|Clutter|Shell|Meta)(?:\?|["'])/.test(source)
      )
        errors.push(`${file}: preferences code imports a Shell-only API`);
    }

    if (
      normalizedFile === "src/extension.js" ||
      normalizedFile.startsWith("src/shell/")
    ) {
      if (
        /gi:\/\/(?:Gtk|Adw|Gdk|Graphene)(?:\?|["'])/.test(source) ||
        /org\/gnome\/Shell\/Extensions\/js\/extensions\/prefs\.js/.test(source)
      )
        errors.push(`${file}: Shell code imports a Preferences-only API`);
    }
  }

  const visiting = new Set();
  const visited = new Set();

  function visit(file, stack = []) {
    if (visiting.has(file)) {
      const cycleStart = stack.indexOf(file);
      const cycle = [...stack.slice(cycleStart), file].map((entry) =>
        relative(ROOT, entry),
      );
      errors.push(`circular relative import: ${cycle.join(" -> ")}`);
      return;
    }
    if (visited.has(file)) return;

    visiting.add(file);
    stack.push(file);
    for (const dependency of dependencyGraph.get(file) ?? [])
      visit(dependency, stack);
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  }

  for (const file of dependencyGraph.keys()) visit(file);

  fail("Import and process-boundary validation", errors);
  console.log("Import and process boundaries passed.");
}

async function checkExtensionContracts() {
  const metadata = JSON.parse(await read("src/metadata.json"));
  const packageJson = JSON.parse(await read("package.json"));
  const prefsEntry = await read("src/prefs.js");
  const schema = await read(
    "assets/org.gnome.shell.extensions.mediashell.gschema.xml",
  );
  const resourceManifest = await read(
    "assets/org.gnome.shell.extensions.mediashell.gresource.xml",
  );
  const sourceFiles = [
    ...(await collect(
      "src",
      (path) => extname(path) === ".js" || path.endsWith("metadata.json"),
    )),
    ...(await collect("assets", (path) =>
      [".xml", ".ui"].includes(extname(path)),
    )),
  ];
  const errors = [];

  if (metadata.uuid !== EXTENSION_UUID)
    errors.push(`metadata.json uuid must be ${EXTENSION_UUID}`);
  if (metadata.uuid !== metadata["gettext-domain"])
    errors.push("metadata uuid and gettext-domain differ");
  if (metadata["version-name"] !== packageJson.version)
    errors.push("package.json version differs from metadata.json version-name");
  if (
    JSON.stringify(metadata["shell-version"]) !==
    JSON.stringify(SUPPORTED_GNOME_SHELL_VERSIONS)
  )
    errors.push(
      "metadata.json shell-version differs from shared platform constants",
    );
  if (!metadata.donations?.buymeacoffee)
    errors.push("metadata.json is missing Buy Me a Coffee donation metadata");

  const schemaId = schema.match(/<schema\s+id="([^"]+)"/)?.[1];
  if (schemaId !== metadata["settings-schema"])
    errors.push(
      "metadata settings-schema differs from the GSettings schema ID",
    );

  if (!prefsEntry.includes("gi://Adw"))
    errors.push("src/prefs.js does not import Libadwaita");
  if (!/assertSupportedLibadwaita\(\)/.test(prefsEntry))
    errors.push(
      "src/prefs.js does not enforce the Libadwaita compatibility guard",
    );
  if (/this\.preferencesController\b/.test(prefsEntry))
    errors.push(
      "src/prefs.js stores a window-scoped PreferencesController on the exported class",
    );

  if (/images\//.test(resourceManifest) || /locale\//.test(resourceManifest))
    errors.push(
      "GResource manifest must not bundle screenshots or gettext catalogs",
    );

  for (const file of sourceFiles) {
    const text = await read(file);
    for (const { pattern, description } of FORBIDDEN_API_PATTERNS) {
      if (pattern.test(text)) errors.push(`${file}: ${description}`);
    }
  }

  fail("Extension contract validation", errors);
  console.log("Extension contracts passed.");
}

function parseSchemaKeys(schema) {
  return new Set(
    [...schema.matchAll(/<key\s+name="([^"]+)"/g)].map((match) => match[1]),
  );
}

async function parseUiObjectIds() {
  const uiFiles = await collect("assets/ui", (path) => extname(path) === ".ui");
  const uiIds = new Set();

  for (const file of uiFiles) {
    const text = await read(file);
    for (const match of text.matchAll(/<object\s+[^>]*id="([^"]+)"/g))
      uiIds.add(match[1]);
  }

  return uiIds;
}

async function checkSettingsContracts() {
  const schema = await read(
    "assets/org.gnome.shell.extensions.mediashell.gschema.xml",
  );
  const schemaKeys = parseSchemaKeys(schema);
  const sourceFiles = await collect("src", (path) => extname(path) === ".js");
  const source = (await Promise.all(sourceFiles.map(read))).join("\n");
  const uiIds = await parseUiObjectIds();
  const errors = [];

  const runtimeKeys = Object.keys(SETTINGS_SPEC);
  const preferenceKeys = PREFERENCE_WIDGET_BINDINGS.map(([key]) => key);

  for (const key of new Set([
    ...runtimeKeys,
    ...preferenceKeys,
    ...KEYBOARD_SHORTCUT_KEYS,
  ])) {
    if (!schemaKeys.has(key))
      errors.push(`code references missing schema key: ${key}`);
  }

  for (const [key, widgetId] of PREFERENCE_WIDGET_BINDINGS) {
    if (!schemaKeys.has(key))
      errors.push(`preference binding references missing schema key: ${key}`);
    if (!uiIds.has(widgetId))
      errors.push(
        `preference binding references missing GtkBuilder object: ${widgetId}`,
      );
  }

  for (const key of runtimeKeys) {
    if (!schemaKeys.has(key))
      errors.push(`SettingsSpec key is missing from schema: ${key}`);
  }

  const shortcutKeys = new Set(KEYBOARD_SHORTCUT_KEYS);
  for (const key of schemaKeys) {
    const isRuntimeKey = runtimeKeys.includes(key);
    const isPreferenceKey = preferenceKeys.includes(key);
    const isShortcutKey = shortcutKeys.has(key);
    if (!isRuntimeKey && !isPreferenceKey && !isShortcutKey)
      errors.push(
        `schema key is not referenced by maintained settings contracts: ${key}`,
      );
  }

  const forbiddenKeyPrefixes = [
    "show-popup-",
    "show-top-bar-",
    "popup-show-",
    "top-bar-show-",
    "shortcut-",
    "mouse-action-",
    "use-colored-",
  ];
  const forbiddenKeys = new Set([
    "top-bar-track-information-lock-width",
    "album-art-cache",
    "hide-system-media-controls",
    "cache-album-art",
    "top-bar-position",
    "top-bar-index",
  ]);
  for (const key of schemaKeys) {
    if (forbiddenKeys.has(key))
      errors.push(`schema key uses obsolete name: ${key}`);
    for (const prefix of forbiddenKeyPrefixes) {
      if (key.startsWith(prefix))
        errors.push(`schema key uses obsolete prefix ${prefix}: ${key}`);
    }
    if (key.includes("-show-"))
      errors.push(`schema key must keep show as a terminal property: ${key}`);
  }

  if (/settings-schema-version|SETTINGS_SCHEMA_VERSION/.test(source))
    errors.push(
      "runtime source must not use a schema-version key without an active migration layer",
    );

  const actionIds = INPUT_ACTION_DEFINITIONS.map(({ id }) => id);
  if (new Set(actionIds).size !== actionIds.length)
    errors.push("input action IDs are not unique");
  if (new Set(KEYBOARD_SHORTCUT_KEYS).size !== KEYBOARD_SHORTCUT_KEYS.length)
    errors.push("keyboard shortcut keys are not unique");
  for (const shortcutKey of KEYBOARD_SHORTCUT_KEYS) {
    if (!shortcutKey.startsWith("interactions-shortcut-"))
      errors.push(
        `keyboard shortcut key must use interactions-shortcut-* prefix: ${shortcutKey}`,
      );
  }

  fail("Settings contract validation", errors);
  console.log("Settings contracts passed.");
}

function stripLinkSuffix(target) {
  return target.split("#", 1)[0].split("?", 1)[0];
}

async function checkRepositoryReferences() {
  const packageJson = JSON.parse(await read("package.json"));
  const documentationFiles = [
    "README.md",
    ...((await pathExists(rootPath("CONTRIBUTING.md")))
      ? ["CONTRIBUTING.md"]
      : []),
    ...(await collect("docs", (path) => extname(path) === ".md")),
    ...(await collect(
      ".github/ISSUE_TEMPLATE",
      (path) => extname(path) === ".md",
    )),
  ];
  const requiredEntryPoints = [
    "src/extension.js",
    "src/prefs.js",
    "src/metadata.json",
    "src/stylesheet.css",
    "assets/org.gnome.shell.extensions.mediashell.gschema.xml",
    "assets/org.gnome.shell.extensions.mediashell.gresource.xml",
  ];
  const errors = [];

  for (const path of requiredEntryPoints) {
    if (!(await pathExists(rootPath(path))))
      errors.push(`required project entry point is missing: ${path}`);
  }

  for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
    for (const match of command.matchAll(/(?:^|[\s"'])(scripts\/[\w./-]+)/g)) {
      const scriptPath = match[1];
      if (!(await pathExists(rootPath(scriptPath))))
        errors.push(`package script ${name} references missing ${scriptPath}`);
    }
  }

  for (const file of documentationFiles) {
    const text = await read(file);
    const base = dirname(rootPath(file));
    const headings = new Set();

    for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
      const heading = match[1].trim().toLocaleLowerCase("en-US");
      if (headings.has(heading))
        errors.push(`${file}: duplicate heading ${match[1].trim()}`);
      headings.add(heading);
    }

    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const rawTarget = match[1].trim().replace(/^<|>$/g, "");
      if (!rawTarget || /^(?:https?:|mailto:|#)/.test(rawTarget)) continue;

      const target = stripLinkSuffix(rawTarget);
      if (!target) continue;
      if (!(await pathExists(resolve(base, decodeURIComponent(target)))))
        errors.push(`${file}: broken relative link ${rawTarget}`);
    }

    for (const match of text.matchAll(
      /`((?:src|assets|scripts|docs|tests|\.github)\/[^`\n]+)`/g,
    )) {
      let documentedPath = match[1].trim().replace(/[),.;:]+$/, "");
      if (documentedPath.includes(" ") || documentedPath.includes("${"))
        continue;
      if (documentedPath.includes("*"))
        documentedPath = dirname(documentedPath);
      if (!(await pathExists(rootPath(documentedPath))))
        errors.push(`${file}: documented path does not exist: ${match[1]}`);
    }

    for (const match of text.matchAll(
      /(?:^|`)pnpm(?:\s+run)?\s+([a-zA-Z][\w:-]*)/gm,
    )) {
      const command = match[1];
      if (
        ["install", "exec", "dlx", "add", "remove", "update"].includes(command)
      )
        continue;
      if (!(command in (packageJson.scripts ?? {})))
        errors.push(`${file}: unknown pnpm script ${command}`);
    }
  }

  fail("Repository reference validation", errors);
  console.log("Repository references passed.");
}

function removeTranslatedStrings(text) {
  return text.replace(/msgstr(?:\[\d+\])?\s+"(?:[^"\\]|\\.)*"/g, "");
}

async function checkSourceHygiene() {
  const files = [
    ...(await collect(
      "src",
      (path) => extname(path) === ".js" || path.endsWith("stylesheet.css"),
    )),
    ...(await collect("assets/ui", (path) => extname(path) === ".ui")),
    ...(await collect(
      "scripts",
      (path) =>
        [".js", ".mjs", ".py", ".sh"].includes(extname(path)) ||
        path.endsWith("development.sh"),
    )),
    ...(await collect("tests", (path) =>
      [".js", ".mjs"].includes(extname(path)),
    )),
    "README.md",
    ...((await pathExists(rootPath("CONTRIBUTING.md")))
      ? ["CONTRIBUTING.md"]
      : []),
    ...(await collect("docs", (path) => extname(path) === ".md")),
    ...(await collect(
      ".github/ISSUE_TEMPLATE",
      (path) => extname(path) === ".md",
    )),
  ];
  const errors = [];
  const obsoleteRuntimeContracts = [
    "SettingsMigration",
    "settings-schema-version",
    "SETTINGS_SCHEMA_VERSION",
    "ShortcutsPageController",
    "TopBarStructureController",
    "SystemMediaControlsPatch",
  ];
  const obsoleteSettingKeys = [
    "show-popup-",
    "show-top-bar-",
    "popup-show-",
    "top-bar-show-",
    "use-colored-",
    "hide-system-media-controls",
    "cache-album-art",
    "top-bar-position",
    "top-bar-index",
  ];

  for (const file of files) {
    const text = removeTranslatedStrings(await read(file));
    if (file !== "scripts/check.mjs") {
      for (const term of obsoleteRuntimeContracts) {
        if (text.includes(term))
          errors.push(`${file}: obsolete runtime contract remains: ${term}`);
      }
      for (const term of obsoleteSettingKeys) {
        if (text.includes(term))
          errors.push(`${file}: obsolete settings key remains: ${term}`);
      }
    }

    if (
      file.startsWith("src/") &&
      file !== "src/shared/utils/log.js" &&
      /\bconsole\.(?:debug|log|warn|error)\b/.test(text)
    )
      errors.push(
        `${file}: use shared createLogger() instead of direct console logging`,
      );
  }

  const prefsUi = await read("assets/ui/prefs.ui");
  if (/title="System"/.test(prefsUi))
    errors.push(
      "assets/ui/prefs.ui: System must not be used as a page or group title",
    );

  fail("Source hygiene validation", errors);
  console.log("Source hygiene passed.");
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
  if (result.status !== 0)
    throw new Error(
      result.stderr.trim() || "python3 zipfile validation failed",
    );

  return JSON.parse(result.stdout);
}

function validateArchiveShape(entries) {
  const errors = [];
  const names = entries.map(({ name }) => name);
  const uniqueNames = new Set(names);

  if (uniqueNames.size !== names.length)
    errors.push("archive contains duplicate entries");

  for (const name of names) {
    if (name.startsWith("/") || name.includes("../") || name.startsWith("../"))
      errors.push(`${name}: unsafe archive path`);
  }

  return errors;
}

function validatePackageMetadata(metadata, packageJson) {
  const errors = [];
  const requiredFields = [
    "uuid",
    "name",
    "description",
    "shell-version",
    "settings-schema",
    "gettext-domain",
    "version-name",
    "url",
  ];

  for (const field of requiredFields) {
    if (!(field in metadata)) errors.push(`metadata.json is missing ${field}`);
  }

  if (metadata.uuid !== EXTENSION_UUID)
    errors.push(`metadata.json uuid must be ${EXTENSION_UUID}`);
  if (metadata["gettext-domain"] !== EXTENSION_UUID)
    errors.push(`metadata.json gettext-domain must be ${EXTENSION_UUID}`);
  if (metadata["version-name"] !== packageJson.version)
    errors.push("metadata.json version-name differs from package.json version");
  if (
    JSON.stringify(metadata["shell-version"]) !==
    JSON.stringify(SUPPORTED_GNOME_SHELL_VERSIONS)
  )
    errors.push(
      "metadata.json shell-version differs from supported platform constants",
    );
  if (!metadata.donations?.buymeacoffee)
    errors.push("metadata.json is missing Buy Me a Coffee donation metadata");

  return errors;
}

function validateRequiredRuntimeEntries(entrySet, metadata) {
  const errors = [];
  const schemaName =
    metadata?.["settings-schema"] ?? "org.gnome.shell.extensions.mediashell";
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

function validateForbiddenPackageEntries(entries) {
  const errors = [];
  const forbiddenPatterns = [
    [
      /^(?:assets|docs|tests|node_modules|dist|\.github)(?:\/|$)/,
      "repository-only directory must not be shipped",
    ],
    [
      /(?:^|\/)(?:README|CONTRIBUTING|package|pnpm-lock)\.(?:md|json|yaml|yml)$/,
      "repository metadata must not be shipped",
    ],
    [
      /(?:^|\/)gschemas\.compiled$/,
      "compiled GSettings schemas must not be shipped",
    ],
    [/\.po(?:~)?$|\.pot$/, "source gettext catalogs must not be shipped"],
    [
      /(?:^|\/)(?:screenshots?|store-assets?)(?:\/|$)/,
      "store screenshots must not be shipped",
    ],
    [
      /(?:^|\/)screen_[^/]+\.png$/,
      "store screenshot image must not be shipped",
    ],
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

function validatePackageText(contents) {
  const errors = [];
  for (const [name, text] of Object.entries(contents)) {
    for (const { pattern, description } of FORBIDDEN_API_PATTERNS) {
      if (pattern.test(text)) errors.push(`${name}: ${description}`);
    }
  }

  return errors;
}

async function checkPackage(inputPath = EXTENSION_PACKAGE) {
  const packagePath = resolve(ROOT, inputPath);
  const displayPackagePath = relative(ROOT, packagePath) || inputPath;

  if (!(await pathExists(packagePath))) {
    console.error(
      `Package validation failed:\n- package not found: ${displayPackagePath}`,
    );
    process.exit(1);
  }

  let archive;
  try {
    archive = readZip(packagePath);
  } catch (error) {
    console.error(
      `Package validation failed:\n- could not inspect package: ${error.message}`,
    );
    process.exit(1);
  }

  const packageJson = JSON.parse(await read("package.json"));
  const entries = archive.entries;
  const entrySet = new Set(entries.map(({ name }) => name));
  const errors = [];
  let metadata = null;

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
  if (metadata !== null)
    errors.push(...validatePackageMetadata(metadata, packageJson));
  errors.push(...validateRequiredRuntimeEntries(entrySet, metadata));
  errors.push(...validateForbiddenPackageEntries(entries));
  errors.push(...validatePackageText(archive.contents));

  fail("Package validation", errors);
  console.log(
    `Package validation passed for ${entries.length} runtime files: ${displayPackagePath}`,
  );
}

async function checkSource() {
  const checks = [
    ["JavaScript syntax", checkSyntax],
    ["module documentation", checkModuleDocumentation],
    ["class lifecycle ordering", checkClassLifecycleOrder],
    ["imports and process boundaries", checkImportsAndBoundaries],
    ["extension contracts", checkExtensionContracts],
    ["settings contracts", checkSettingsContracts],
    ["repository references", checkRepositoryReferences],
    ["source hygiene", checkSourceHygiene],
  ];

  for (const [label, check] of checks) {
    console.log(`\n==> ${label}`);
    await check();
  }

  runCommand("unit tests", process.execPath, ["--test"]);
  runCommand("resources, schema, and translations", "python3", [
    "scripts/check-assets.py",
  ]);
  runCommand("development script syntax", "bash", [
    "-n",
    "scripts/development.sh",
  ]);

  console.log(`\nAll ${checks.length + 3} validation groups passed.`);
}

const [mode, packagePath] = process.argv.slice(2);

if (mode === "--package") {
  await checkPackage(packagePath ?? EXTENSION_PACKAGE);
} else if (mode === undefined) {
  await checkSource();
} else {
  console.error(
    `Unknown argument: ${mode}\nUse either 'node scripts/check.mjs' or 'node scripts/check.mjs --package [zip]'.`,
  );
  process.exit(1);
}
