/**
 * @file javascript.mjs
 * @module scripts.dev.javascript
 *
 * Validates JavaScript syntax, static imports, process boundaries, GNOME entry
 * point inheritance, and stable runtime API constraints.
 *
 * These checks intentionally avoid guessing lifecycle, ownership, naming, or
 * module usefulness from source shape. Behavior and teardown belong in tests
 * and live GNOME validation.
 */

import { dirname, relative, resolve } from "node:path";

import { parse } from "acorn";
import { simple } from "acorn-walk";

import {
  ROOT,
  collectJavaScript,
  fail,
  isFile,
  read,
  rootPath,
} from "./files.mjs";

let recordsPromise = null;

function lineOf(node) {
  return node.loc?.start.line ?? 1;
}

/** Parses one ECMAScript module with the canonical project parser options. */
export function parseJavaScriptModule(file, source) {
  const ast = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
    allowHashBang: true,
  });
  return { file, source, ast };
}

async function loadRecords() {
  recordsPromise ??= (async () => {
    const files = [
      ...(await collectJavaScript("src")),
      ...(await collectJavaScript("scripts")),
      ...(await collectJavaScript("tests")),
    ];
    const records = new Map();
    const errors = [];

    for (const file of files) {
      const source = await read(file);
      try {
        records.set(file, parseJavaScriptModule(file, source));
      } catch (error) {
        const location = error.loc
          ? `${file}:${error.loc.line}:${error.loc.column + 1}`
          : file;
        errors.push(`${location}: ${error.message}`);
      }
    }

    fail("JavaScript syntax validation", errors);
    return records;
  })();
  return recordsPromise;
}

/** Returns cached parsed modules for validators and translation extraction. */
export async function getJavaScriptRecords() {
  return loadRecords();
}

function declarationNames(declaration) {
  if (!declaration) return [];
  if (declaration.id?.type === "Identifier") return [declaration.id.name];
  if (declaration.type !== "VariableDeclaration") return [];

  const names = [];
  for (const item of declaration.declarations) {
    if (item.id.type === "Identifier") names.push(item.id.name);
    else if (item.id.type === "ObjectPattern") {
      for (const property of item.id.properties) {
        if (
          property.type === "Property" &&
          property.value.type === "Identifier"
        )
          names.push(property.value.name);
      }
    }
  }
  return names;
}

/** Collects static, re-exported, and literal dynamic module specifiers. */
export function collectModuleSpecifiers(record) {
  const specifiers = [];
  for (const node of record.ast.body) {
    if (
      node.type === "ImportDeclaration" &&
      typeof node.source.value === "string"
    ) {
      specifiers.push({
        value: node.source.value,
        line: lineOf(node),
        node,
        kind: "import",
      });
      continue;
    }
    if (
      ["ExportAllDeclaration", "ExportNamedDeclaration"].includes(node.type) &&
      typeof node.source?.value === "string"
    ) {
      specifiers.push({
        value: node.source.value,
        line: lineOf(node),
        node,
        kind: "export",
      });
    }
  }

  simple(record.ast, {
    ImportExpression(node) {
      if (
        node.source.type === "Literal" &&
        typeof node.source.value === "string"
      ) {
        specifiers.push({
          value: node.source.value,
          line: lineOf(node),
          node,
          kind: "dynamic",
        });
      }
    },
  });
  return specifiers;
}

function exportedNames(record) {
  const names = new Set();
  for (const node of record.ast.body) {
    if (node.type === "ExportDefaultDeclaration") {
      names.add("default");
      continue;
    }
    if (node.type !== "ExportNamedDeclaration") continue;
    for (const name of declarationNames(node.declaration)) names.add(name);
    for (const specifier of node.specifiers)
      names.add(specifier.exported.name ?? specifier.exported.value);
  }
  return names;
}

/** Returns imported bindings that are absent from a parsed target module. */
export function findMissingImportedNames(importNode, targetRecord) {
  if (importNode.type !== "ImportDeclaration") return [];
  const availableExports = exportedNames(targetRecord);
  const missing = [];
  for (const imported of importNode.specifiers) {
    if (imported.type === "ImportNamespaceSpecifier") continue;
    const importedName =
      imported.type === "ImportDefaultSpecifier"
        ? "default"
        : (imported.imported.name ?? imported.imported.value);
    if (!availableExports.has(importedName)) missing.push(importedName);
  }
  return missing;
}

function sourceLayer(file) {
  if (file === "src/extension.js" || file.startsWith("src/shell/"))
    return "shell";
  if (file === "src/prefs.js" || file.startsWith("src/prefs/")) return "prefs";
  if (file.startsWith("src/shared/")) return "shared";
  return null;
}

function isShellOnlyImport(specifier) {
  return (
    specifier.startsWith("resource:///org/gnome/shell/ui/") ||
    /^gi:\/\/(?:St|Clutter|Shell|Meta)(?:\?|$)/.test(specifier)
  );
}

function isPreferencesOnlyImport(specifier) {
  return (
    /^gi:\/\/(?:Gtk|Adw|Gdk)(?:\?|$)/.test(specifier) ||
    specifier.includes("/extensions/prefs.js")
  );
}

/** Validates an external import against a process layer. */
export function validateExternalImport(layer, specifier) {
  const errors = [];
  if (layer === "shared" && /^(?:gi|resource):/.test(specifier))
    errors.push(`shared code imports GNOME runtime API ${specifier}`);
  if (layer === "prefs" && isShellOnlyImport(specifier))
    errors.push(`preferences code imports Shell-only API ${specifier}`);
  if (layer === "shell" && isPreferencesOnlyImport(specifier))
    errors.push(`Shell code imports preferences-only API ${specifier}`);
  return errors;
}

/** Validates the static portion of a relative source import. */
export function validateRelativeImport(layer, targetLayer, specifier) {
  const errors = [];
  if (!specifier.endsWith(".js") && !specifier.endsWith(".mjs"))
    errors.push(
      `relative module import needs an explicit extension: ${specifier}`,
    );
  if (
    targetLayer &&
    ((layer === "shared" && targetLayer !== "shared") ||
      (layer === "shell" && targetLayer === "prefs") ||
      (layer === "prefs" && targetLayer === "shell"))
  )
    errors.push(`${layer} module crosses into ${targetLayer}`);
  return errors;
}

/** Keeps the private GNOME Shell MPRIS import behind its compatibility adapter. */
export function validatePrivateShellImport(file, specifier) {
  if (
    specifier !== "resource:///org/gnome/shell/ui/mpris.js" ||
    file === "src/shell/services/GnomeShellMediaControlsPatch.js"
  )
    return null;
  return `${file}: private Shell MPRIS API must stay isolated in GnomeShellMediaControlsPatch`;
}

export async function checkJavaScriptSyntax() {
  const records = await loadRecords();
  console.log(`JavaScript parsing passed for ${records.size} modules.`);
}

export async function checkImportsAndBoundaries() {
  const records = await loadRecords();
  const sourceRecords = new Map(
    [...records].filter(([file]) => file.startsWith("src/")),
  );
  const dependencyGraph = new Map(
    [...sourceRecords].map(([file]) => [file, []]),
  );
  const errors = [];

  for (const record of sourceRecords.values()) {
    const layer = sourceLayer(record.file);
    if (!layer) {
      errors.push(
        `${record.file}: runtime JavaScript must belong to the shell, preferences, or shared source layer`,
      );
    }

    for (const item of collectModuleSpecifiers(record)) {
      const specifier = item.value;
      if (!specifier.startsWith(".")) {
        for (const error of validateExternalImport(layer, specifier))
          errors.push(`${record.file}:${item.line}: ${error}`);
        const privateImportError = validatePrivateShellImport(
          record.file,
          specifier,
        );
        if (privateImportError)
          errors.push(`${privateImportError} (line ${item.line})`);
        continue;
      }

      const absoluteTarget = resolve(dirname(rootPath(record.file)), specifier);
      if (!(await isFile(absoluteTarget))) {
        errors.push(
          `${record.file}:${item.line}: missing relative import ${specifier}`,
        );
        continue;
      }

      const target = relative(ROOT, absoluteTarget).replaceAll("\\", "/");
      const targetLayer = sourceLayer(target);
      if (!sourceRecords.has(target)) {
        errors.push(
          `${record.file}:${item.line}: runtime relative import leaves the packaged source tree: ${target}`,
        );
        continue;
      }
      for (const error of validateRelativeImport(layer, targetLayer, specifier))
        errors.push(`${record.file}:${item.line}: ${error}: ${target}`);

      dependencyGraph.get(record.file).push(target);

      if (item.kind === "import") {
        for (const importedName of findMissingImportedNames(
          item.node,
          sourceRecords.get(target),
        ))
          errors.push(
            `${record.file}:${item.line}: ${target} does not export ${importedName}`,
          );
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(file, stack = []) {
    if (visiting.has(file)) {
      const cycleStart = stack.indexOf(file);
      errors.push(
        `circular relative import: ${[...stack.slice(cycleStart), file].join(" -> ")}`,
      );
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
  console.log("Imports, exports, cycles, and process boundaries passed.");
}

export function memberPath(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "ThisExpression") return "this";
  if (node?.type !== "MemberExpression") return null;
  const owner = memberPath(node.object);
  const property =
    !node.computed && node.property.type === "Identifier"
      ? node.property.name
      : node.property.type === "Literal"
        ? String(node.property.value)
        : null;
  return owner && property ? `${owner}.${property}` : null;
}

function objectPropertyName(property) {
  if (property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal") return String(property.key.value);
  return null;
}

/** Checks only stable, removed, or explicitly unsupported runtime APIs. */
export async function checkRuntimeApiUsage() {
  const records = await loadRecords();
  const errors = [];

  for (const record of records.values()) {
    if (!record.file.startsWith("src/")) continue;
    simple(record.ast, {
      NewExpression(node) {
        if (!memberPath(node.callee)?.startsWith("St.")) return;
        const properties =
          node.arguments[0]?.type === "ObjectExpression"
            ? node.arguments[0].properties
            : [];
        if (
          properties.some(
            (property) => objectPropertyName(property) === "vertical",
          )
        )
          errors.push(
            `${record.file}:${lineOf(node)}: St actors use orientation instead of the deprecated vertical property`,
          );
      },
      CallExpression(node) {
        const path = memberPath(node.callee);
        if (path?.endsWith(".run_dispose"))
          errors.push(
            `${record.file}:${lineOf(node)}: manual run_dispose() is not allowed`,
          );
      },
      MemberExpression(node) {
        const path = memberPath(node);
        if (["Clutter.ClickAction", "Clutter.TapAction"].includes(path))
          errors.push(
            `${record.file}:${lineOf(node)}: removed Clutter action class ${path}`,
          );
        if (/^imports\.(?:ui|misc|gi)(?:\.|$)/.test(path ?? ""))
          errors.push(
            `${record.file}:${lineOf(node)}: legacy GJS imports are not allowed`,
          );
      },
    });
  }

  fail("Runtime API validation", errors);
  console.log("Stable GNOME runtime API constraints passed.");
}

function importedBindingName(record, moduleName, exportedName) {
  for (const node of record.ast.body) {
    if (node.type !== "ImportDeclaration" || node.source.value !== moduleName)
      continue;
    for (const specifier of node.specifiers) {
      if (
        specifier.type === "ImportSpecifier" &&
        (specifier.imported.name ?? specifier.imported.value) === exportedName
      )
        return specifier.local.name;
    }
  }
  return null;
}

function resolveTopLevelClass(record, name) {
  for (const node of record.ast.body) {
    if (node.type === "ClassDeclaration" && node.id?.name === name) return node;
    if (node.type !== "VariableDeclaration") continue;
    for (const declaration of node.declarations) {
      if (
        declaration.id.type === "Identifier" &&
        declaration.id.name === name &&
        declaration.init?.type === "ClassExpression"
      )
        return declaration.init;
    }
  }
  return null;
}

function resolveDefaultExportClass(record) {
  let exportedName = null;
  for (const node of record.ast.body) {
    if (node.type === "ExportDefaultDeclaration") {
      if (
        ["ClassDeclaration", "ClassExpression"].includes(node.declaration.type)
      )
        return node.declaration;
      if (node.declaration.type === "Identifier")
        exportedName = node.declaration.name;
    }
    if (node.type !== "ExportNamedDeclaration") continue;
    for (const specifier of node.specifiers) {
      if (
        (specifier.exported.name ?? specifier.exported.value) === "default" &&
        specifier.local.type === "Identifier"
      )
        exportedName = specifier.local.name;
    }
  }
  return exportedName ? resolveTopLevelClass(record, exportedName) : null;
}

function classMethodNames(classNode) {
  return new Set(
    classNode.body.body
      .filter(
        (item) =>
          item.type === "MethodDefinition" &&
          item.kind === "method" &&
          !item.static &&
          ((!item.computed && item.key.type === "Identifier") ||
            (item.computed &&
              item.key.type === "Literal" &&
              typeof item.key.value === "string")),
      )
      .map((item) => item.key.name ?? item.key.value),
  );
}

/** Validates one GNOME entry point through resolved AST bindings and inheritance. */
export function validateEntryPointModule(record, contract) {
  if (!record) return [`${contract.file}: entry-point module is missing`];

  const errors = [];
  const baseBinding = importedBindingName(
    record,
    contract.baseModule,
    contract.baseExport,
  );
  if (!baseBinding)
    errors.push(
      `${contract.file}: must import ${contract.baseExport} from ${contract.baseModule}`,
    );

  const entryPointClass = resolveDefaultExportClass(record);
  if (!entryPointClass) {
    errors.push(
      `${contract.file}: default export must resolve to a local class`,
    );
    return errors;
  }

  if (
    !baseBinding ||
    entryPointClass.superClass?.type !== "Identifier" ||
    entryPointClass.superClass.name !== baseBinding
  )
    errors.push(
      `${contract.file}: default class must extend the imported ${contract.baseExport}`,
    );

  const methods = classMethodNames(entryPointClass);
  for (const method of contract.requiredMethods) {
    if (!methods.has(method))
      errors.push(`${contract.file}: missing ${method}()`);
  }
  return errors;
}

export async function checkEntryPointContracts() {
  const records = await loadRecords();
  const errors = [];

  for (const contract of [
    {
      file: "src/extension.js",
      baseModule: "resource:///org/gnome/shell/extensions/extension.js",
      baseExport: "Extension",
      requiredMethods: ["enable", "disable"],
    },
    {
      file: "src/prefs.js",
      baseModule:
        "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js",
      baseExport: "ExtensionPreferences",
      requiredMethods: ["fillPreferencesWindow"],
    },
  ])
    errors.push(
      ...validateEntryPointModule(records.get(contract.file), contract),
    );

  fail("Entry-point contract validation", errors);
  console.log("Extension and preferences entry points passed.");
}

/** Collects literal GtkBuilder object IDs referenced by preferences code. */
export async function collectBuilderObjectReferences() {
  const records = await loadRecords();
  const references = [];
  for (const record of records.values()) {
    if (!record.file.startsWith("src/prefs")) continue;
    simple(record.ast, {
      CallExpression(node) {
        if (
          node.callee.type !== "MemberExpression" ||
          memberPath(node.callee)?.split(".").at(-1) !== "get_object" ||
          node.arguments[0]?.type !== "Literal" ||
          typeof node.arguments[0].value !== "string"
        )
          return;
        references.push({
          id: node.arguments[0].value,
          file: record.file,
          line: lineOf(node),
        });
      },
    });
  }
  return references;
}
