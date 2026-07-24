/**
 * @file javascript.mjs
 * @module scripts.dev.javascript
 *
 * Validates JavaScript syntax, module imports, process boundaries, and runtime safety.
 *
 * Acorn parses every checked module and acorn-walk inspects semantic nodes, so
 * comments, string contents, or formatting cannot masquerade as executable code.
 */

import { dirname, relative, resolve } from "node:path";

import { parse } from "acorn";
import { ancestor, simple } from "acorn-walk";

import {
  ROOT,
  collectJavaScript,
  fail,
  isFile,
  read,
  rootPath,
} from "./files.mjs";

const SOURCE_ENTRY_POINTS = new Set(["src/extension.js", "src/prefs.js"]);

let recordsPromise = null;

function lineOf(node) {
  return node.loc?.start.line ?? 1;
}

function parseModule(file, source) {
  const comments = [];
  const ast = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
    allowHashBang: true,
    onComment: comments,
  });
  return { file, source, ast, comments };
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
        records.set(file, parseModule(file, source));
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

function isJSDoc(comment) {
  return comment?.type === "Block" && comment.value.startsWith("*");
}

function leadingJSDoc(record, node) {
  for (let index = record.comments.length - 1; index >= 0; index--) {
    const comment = record.comments[index];
    if (comment.end > node.start) continue;
    const between = record.source.slice(comment.end, node.start).trim();
    if (between && !/^export(?:\s+default)?$/.test(between)) return null;
    return isJSDoc(comment) ? comment : null;
  }
  return null;
}

function classNames(record) {
  const names = new Set();
  simple(record.ast, {
    ClassDeclaration(node) {
      if (node.id?.name) names.add(node.id.name);
    },
  });
  return names;
}

function exportsClass(record) {
  const names = classNames(record);
  for (const node of record.ast.body) {
    if (
      node.type === "ExportDefaultDeclaration" &&
      node.declaration.type === "ClassDeclaration"
    )
      return true;
    if (
      node.type === "ExportNamedDeclaration" &&
      node.declaration?.type === "ClassDeclaration"
    )
      return true;
    if (
      node.type === "ExportDefaultDeclaration" &&
      node.declaration.type === "CallExpression" &&
      memberPath(node.declaration.callee)?.endsWith(".registerClass")
    ) {
      const registeredClass = node.declaration.arguments.at(-1);
      if (
        registeredClass?.type === "Identifier" &&
        names.has(registeredClass.name)
      )
        return true;
    }
  }
  return false;
}

function loggerScopes(record) {
  const scopes = [];
  simple(record.ast, {
    CallExpression(node) {
      if (
        node.callee.type === "Identifier" &&
        node.callee.name === "createLogger" &&
        node.arguments[0]?.type === "Literal" &&
        typeof node.arguments[0].value === "string"
      )
        scopes.push({ scope: node.arguments[0].value, line: lineOf(node) });
    },
  });
  return scopes;
}

export async function checkJavaScriptSyntax() {
  const records = await loadRecords();
  console.log(`JavaScript AST parsing passed for ${records.size} modules.`);
}

export async function inspectModuleDocumentationAndNaming() {
  const records = await loadRecords();
  const errors = [];

  for (const record of records.values()) {
    const { file, source, comments } = record;
    const header = comments[0];
    const expectedFile = file.split("/").at(-1);
    if (!isJSDoc(header) || source.slice(0, header.start).trim()) {
      errors.push(`${file}: missing leading module JSDoc`);
      continue;
    }

    if (!header.value.includes(`@file ${expectedFile}`))
      errors.push(`${file}: module JSDoc has no matching @file`);
    if (!/@module\s+[A-Za-z0-9_.-]+/.test(header.value))
      errors.push(`${file}: module JSDoc has no @module name`);

    const proseLines = header.value
      .split("\n")
      .map((line) => line.replace(/^\s*\* ?/, "").trim())
      .filter((line) => line && !line.startsWith("@"));
    if (proseLines.length < 2)
      errors.push(
        `${file}: module JSDoc must describe responsibility and purpose`,
      );

    simple(record.ast, {
      ClassDeclaration(node) {
        if (!leadingJSDoc(record, node))
          errors.push(
            `${file}:${lineOf(node)}: class ${node.id?.name ?? "<anonymous>"} needs adjacent JSDoc`,
          );
      },
    });

    if (!file.startsWith("src/") || SOURCE_ENTRY_POINTS.has(file)) continue;
    const basename = expectedFile.replace(/\.js$/, "");
    const isClassModule = /^[A-Z][A-Za-z0-9]*$/.test(basename);
    const names = classNames(record);

    if (isClassModule && !names.has(basename))
      errors.push(
        `${file}: PascalCase module must define its matching ${basename} class`,
      );
    if (!isClassModule && exportsClass(record))
      errors.push(
        `${file}: class modules use a PascalCase filename matching the owned class`,
      );

    for (const { scope, line } of loggerScopes(record)) {
      if (scope !== basename)
        errors.push(
          `${file}:${line}: logger scope ${scope} must match ${basename}`,
        );
    }
  }

  return errors;
}

export async function checkModuleDocumentationAndNaming() {
  const errors = await inspectModuleDocumentationAndNaming();
  fail("Module documentation and naming validation", errors);
  console.log("Module documentation and naming passed.");
}

function moduleSpecifiers(record) {
  const specifiers = [];
  for (const node of record.ast.body) {
    if (
      node.type === "ImportDeclaration" &&
      typeof node.source.value === "string"
    )
      specifiers.push({
        value: node.source.value,
        line: lineOf(node),
        node,
        kind: "import",
      });
    else if (
      ["ExportAllDeclaration", "ExportNamedDeclaration"].includes(node.type) &&
      typeof node.source?.value === "string"
    )
      specifiers.push({
        value: node.source.value,
        line: lineOf(node),
        node,
        kind: "export",
      });
  }
  simple(record.ast, {
    ImportExpression(node) {
      if (
        node.source.type === "Literal" &&
        typeof node.source.value === "string"
      )
        specifiers.push({
          value: node.source.value,
          line: lineOf(node),
          node,
          kind: "dynamic",
        });
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
    const declaration = node.declaration;
    if (declaration?.id?.name) names.add(declaration.id.name);
    if (declaration?.type === "VariableDeclaration") {
      for (const item of declaration.declarations) {
        if (item.id.type === "Identifier") names.add(item.id.name);
      }
    }
    for (const specifier of node.specifiers)
      names.add(specifier.exported.name ?? specifier.exported.value);
  }
  return names;
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
    /^gi:\/\/(?:Gtk|Adw|Gdk|Graphene)(?:\?|$)/.test(specifier) ||
    specifier.includes("/extensions/prefs.js")
  );
}

/**
 * Validates an external import against a process layer.
 *
 * @param {string} layer - Source layer.
 * @param {string} specifier - External module specifier.
 * @returns {string[]} Boundary errors.
 */
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

/**
 * Validates the static portion of a relative source import.
 *
 * @param {string} layer - Importing source layer.
 * @param {string|null} targetLayer - Resolved target layer.
 * @param {string} specifier - Relative module specifier.
 * @returns {string[]} Boundary errors.
 */
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
    for (const item of moduleSpecifiers(record)) {
      const specifier = item.value;
      if (!specifier.startsWith(".")) {
        for (const error of validateExternalImport(layer, specifier))
          errors.push(`${record.file}:${item.line}: ${error}`);
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
      for (const error of validateRelativeImport(layer, targetLayer, specifier))
        errors.push(`${record.file}:${item.line}: ${error}: ${target}`);

      if (sourceRecords.has(target))
        dependencyGraph.get(record.file).push(target);

      if (item.kind === "import" && sourceRecords.has(target)) {
        const availableExports = exportedNames(sourceRecords.get(target));
        for (const imported of item.node.specifiers) {
          if (imported.type === "ImportNamespaceSpecifier") continue;
          const importedName =
            imported.type === "ImportDefaultSpecifier"
              ? "default"
              : (imported.imported.name ?? imported.imported.value);
          if (!availableExports.has(importedName))
            errors.push(
              `${record.file}:${item.line}: ${target} does not export ${importedName}`,
            );
        }
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

function memberPath(node) {
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

function mainLoopSourceDiagnostics(record) {
  const classSources = new Map();
  const teardownMethods = new Set([
    "disable",
    "destroy",
    "_destroy",
    "dispose",
    "cleanup",
    "stop",
  ]);
  const teardownSignals = new Set(["closed", "close-request", "destroy"]);

  function owningClass(ancestors) {
    return [...ancestors]
      .reverse()
      .find((node) =>
        ["ClassDeclaration", "ClassExpression"].includes(node.type),
      );
  }

  function owningMethod(ancestors) {
    return [...ancestors]
      .reverse()
      .find((node) => node.type === "MethodDefinition");
  }

  function isDirectMethodNode(ancestors, method) {
    const functionOwner = [...ancestors]
      .reverse()
      .find((node) =>
        [
          "ArrowFunctionExpression",
          "FunctionDeclaration",
          "FunctionExpression",
        ].includes(node.type),
      );
    return functionOwner === method.value;
  }

  function sourceState(classNode) {
    if (!classSources.has(classNode))
      classSources.set(classNode, {
        assigned: new Map(),
        callsByMethod: new Map(),
        eventTeardownMethods: new Set(),
        removalsByMethod: new Map(),
      });
    return classSources.get(classNode);
  }

  function methodSet(map, method) {
    if (!map.has(method)) map.set(method, new Set());
    return map.get(method);
  }

  ancestor(record.ast, {
    AssignmentExpression(node, ancestors) {
      if (
        node.operator !== "=" ||
        node.right.type !== "CallExpression" ||
        ![
          "GLib.idle_add",
          "GLib.timeout_add",
          "GLib.timeout_add_seconds",
        ].includes(memberPath(node.right.callee))
      )
        return;

      const propertyPath = memberPath(node.left);
      if (!propertyPath?.startsWith("this.")) return;
      const classNode = owningClass(ancestors);
      if (!classNode) return;
      const property = propertyPath.slice("this.".length);
      const state = sourceState(classNode);
      if (!state.assigned.has(property))
        state.assigned.set(property, lineOf(node));
    },
    CallExpression(node, ancestors) {
      const classNode = owningClass(ancestors);
      const method = owningMethod(ancestors);
      const methodName = method && objectPropertyName(method);
      if (!classNode || !methodName || !isDirectMethodNode(ancestors, method))
        return;

      const state = sourceState(classNode);
      const calleePath = memberPath(node.callee);

      if (
        calleePath === "this.connect" &&
        teardownSignals.has(node.arguments[0]?.value)
      ) {
        const callback = node.arguments[1];
        if (
          ["ArrowFunctionExpression", "FunctionExpression"].includes(
            callback?.type,
          )
        ) {
          simple(callback.body, {
            CallExpression(callbackCall) {
              const callbackPath = memberPath(callbackCall.callee);
              if (callbackPath?.startsWith("this."))
                state.eventTeardownMethods.add(
                  callbackPath.slice("this.".length),
                );
            },
          });
        } else if (
          callback?.type === "CallExpression" &&
          memberPath(callback.callee)?.endsWith(".bind")
        ) {
          const callbackPath = memberPath(callback.callee.object);
          if (callbackPath?.startsWith("this."))
            state.eventTeardownMethods.add(callbackPath.slice("this.".length));
        }
      }

      if (calleePath?.startsWith("this."))
        methodSet(state.callsByMethod, methodName).add(
          calleePath.slice("this.".length),
        );

      if (calleePath !== "GLib.Source.remove" || node.arguments.length === 0)
        return;

      const propertyPath = memberPath(node.arguments[0]);
      if (!propertyPath?.startsWith("this.")) return;
      methodSet(state.removalsByMethod, methodName).add(
        propertyPath.slice("this.".length),
      );
    },
  });

  const diagnostics = [];
  for (const state of classSources.values()) {
    const reachableTeardown = new Set([
      ...teardownMethods,
      ...state.eventTeardownMethods,
    ]);
    const pending = [...reachableTeardown];
    while (pending.length > 0) {
      const method = pending.pop();
      for (const called of state.callsByMethod.get(method) ?? []) {
        if (reachableTeardown.has(called)) continue;
        reachableTeardown.add(called);
        pending.push(called);
      }
    }

    const removed = new Set();
    for (const method of reachableTeardown) {
      for (const property of state.removalsByMethod.get(method) ?? [])
        removed.add(property);
    }

    for (const [property, line] of state.assigned) {
      if (!removed.has(property))
        diagnostics.push(
          `${record.file}:${line}: GLib source stored in this.${property} needs a matching GLib.Source.remove(this.${property}) reachable from teardown`,
        );
    }
  }
  return diagnostics;
}

/**
 * Validates that class-owned GLib main-loop sources have explicit removals.
 *
 * @param {string} file - Diagnostic source path.
 * @param {string} source - JavaScript module source.
 * @returns {string[]} Lifecycle diagnostics.
 */
export function validateMainLoopSourceOwnership(file, source) {
  return mainLoopSourceDiagnostics(parseModule(file, source));
}

export async function checkSourceStructure() {
  const records = await loadRecords();
  const errors = [];

  for (const record of records.values()) {
    const isSource = record.file.startsWith("src/");
    if (isSource) errors.push(...mainLoopSourceDiagnostics(record));
    simple(record.ast, {
      NewExpression(node) {
        if (!isSource || !memberPath(node.callee)?.startsWith("St.")) return;
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
        if (!isSource) return;
        const path = memberPath(node.callee);
        if (path?.endsWith(".run_dispose"))
          errors.push(
            `${record.file}:${lineOf(node)}: manual run_dispose() is not allowed`,
          );
      },
      MemberExpression(node) {
        if (!isSource) return;
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

  fail("Source structure validation", errors);
  console.log("Runtime API and logging safety passed.");
}

export async function checkEntryPointContracts() {
  const records = await loadRecords();
  const extension = records.get("src/extension.js");
  const errors = [];

  let extensionLifecycleMethods = null;
  for (const node of extension.ast.body) {
    if (
      node.type === "ExportDefaultDeclaration" &&
      node.declaration.type === "ClassDeclaration"
    ) {
      extensionLifecycleMethods = new Set(
        node.declaration.body.body
          .filter(
            (item) =>
              item.type === "MethodDefinition" &&
              !item.computed &&
              item.key.type === "Identifier",
          )
          .map((item) => item.key.name),
      );
    }
  }
  for (const method of ["enable", "disable"]) {
    if (!extensionLifecycleMethods?.has(method))
      errors.push(`src/extension.js: exported class is missing ${method}()`);
  }

  fail("Entry-point contract validation", errors);
  console.log("Entry-point lifecycle passed.");
}

/**
 * Returns an advisory diagnostic for a misplaced private Shell MPRIS import.
 *
 * @param {string} file - Repository-relative source path.
 * @param {string} specifier - Imported module specifier.
 * @returns {string|null} Diagnostic, or null when the boundary is respected.
 */
export function validatePrivateShellImport(file, specifier) {
  if (
    specifier !== "resource:///org/gnome/shell/ui/mpris.js" ||
    file === "src/shell/services/GnomeShellMediaControlsPatch.js"
  )
    return null;
  return `${file}: private Shell MPRIS API must stay isolated in GnomeShellMediaControlsPatch`;
}

/**
 * Collects maintainability conventions that should not block a runtime build.
 *
 * @returns {Promise<string[]>} Advisory diagnostics.
 */
export async function inspectSourceConventions() {
  const records = await loadRecords();
  const diagnostics = [];

  for (const record of records.values()) {
    if (!record.file.startsWith("src/")) continue;
    for (const item of moduleSpecifiers(record)) {
      const diagnostic = validatePrivateShellImport(record.file, item.value);
      if (diagnostic) diagnostics.push(`${diagnostic} (line ${item.line})`);
    }
    simple(record.ast, {
      CallExpression(node) {
        const path = memberPath(node.callee);
        if (
          path?.startsWith("console.") &&
          record.file !== "src/shared/utils/log.js"
        )
          diagnostics.push(
            `${record.file}:${lineOf(node)}: use shared createLogger() instead of ${path}`,
          );
      },
    });
  }

  return diagnostics;
}

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
