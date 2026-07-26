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
  PLAYER_PROPERTIES,
  ROOT_PROPERTIES,
} from "../../src/shared/constants/dbus.js";
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

/**
 * Returns the cached parsed JavaScript records used by development checks.
 *
 * Callers must treat the returned map and records as read-only. Sharing the
 * cache keeps architecture checks on the same AST and file set as syntax,
 * import, liveness, and lifecycle validation.
 *
 * @returns {Promise<Map<string, object>>} Parsed module records by path.
 */
export async function getJavaScriptRecords() {
  return loadRecords();
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
    for (const name of declarationNames(node.declaration)) names.add(name);
    for (const specifier of node.specifiers)
      names.add(specifier.exported.name ?? specifier.exported.value);
  }
  return names;
}

function resolveModuleTarget(file, specifier) {
  return resolve("/", dirname(file), specifier).slice(1).replaceAll("\\", "/");
}

function declarationNames(declaration) {
  if (!declaration) return [];
  if (declaration.id?.type === "Identifier") return [declaration.id.name];
  if (declaration.type !== "VariableDeclaration") return [];

  const names = [];
  for (const item of declaration.declarations)
    collectPatternIdentifiers(item.id, (identifier) =>
      names.push(identifier.name),
    );
  return names;
}

function exportEntries(record) {
  const entries = [];
  for (const node of record.ast.body) {
    if (node.type === "ExportDefaultDeclaration") {
      entries.push({
        exportedName: "default",
        localName:
          node.declaration.type === "Identifier"
            ? node.declaration.name
            : (node.declaration.id?.name ?? null),
        line: lineOf(node),
      });
      continue;
    }
    if (node.type !== "ExportNamedDeclaration") continue;
    for (const name of declarationNames(node.declaration))
      entries.push({ exportedName: name, localName: name, line: lineOf(node) });
    for (const specifier of node.specifiers) {
      entries.push({
        exportedName: specifier.exported.name ?? specifier.exported.value,
        localName: node.source
          ? null
          : (specifier.local.name ?? specifier.local.value),
        line: lineOf(specifier),
      });
    }
  }
  return entries;
}

function addConsumedExport(consumedExports, target, name) {
  if (!consumedExports.has(target)) consumedExports.set(target, new Set());
  consumedExports.get(target).add(name);
}

function dynamicImportNames(node, ancestors) {
  let expression = node;
  let index = ancestors.length - 2;
  if (ancestors[index]?.type === "AwaitExpression") {
    expression = ancestors[index];
    index--;
  }

  const parent = ancestors[index];
  if (parent?.type !== "VariableDeclarator" || parent.init !== expression)
    return ["*"];
  if (parent.id.type !== "ObjectPattern") return ["*"];

  const names = [];
  for (const property of parent.id.properties) {
    if (property.type === "RestElement") return ["*"];
    if (property.computed) return ["*"];
    const name =
      property.key.type === "Identifier"
        ? property.key.name
        : String(property.key.value);
    names.push(name);
  }
  return names;
}

function collectModuleConsumption(records, entryPoints) {
  const consumedExports = new Map();
  const dependencyGraph = new Map(
    [...records.keys()].map((file) => [file, new Set()]),
  );

  for (const record of records.values()) {
    for (const node of record.ast.body) {
      if (node.type === "ImportDeclaration") {
        const target = node.source.value.startsWith(".")
          ? resolveModuleTarget(record.file, node.source.value)
          : null;
        if (!target || !records.has(target)) continue;
        dependencyGraph.get(record.file).add(target);
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier")
            addConsumedExport(consumedExports, target, "*");
          else if (specifier.type === "ImportDefaultSpecifier")
            addConsumedExport(consumedExports, target, "default");
          else
            addConsumedExport(
              consumedExports,
              target,
              specifier.imported.name ?? specifier.imported.value,
            );
        }
        continue;
      }

      if (
        ["ExportAllDeclaration", "ExportNamedDeclaration"].includes(
          node.type,
        ) &&
        typeof node.source?.value === "string" &&
        node.source.value.startsWith(".")
      ) {
        const target = resolveModuleTarget(record.file, node.source.value);
        if (!records.has(target)) continue;
        dependencyGraph.get(record.file).add(target);
        if (node.type === "ExportAllDeclaration")
          addConsumedExport(consumedExports, target, "*");
        else
          for (const specifier of node.specifiers) {
            if (specifier.type === "ExportNamespaceSpecifier")
              addConsumedExport(consumedExports, target, "*");
            else
              addConsumedExport(
                consumedExports,
                target,
                specifier.local.name ?? specifier.local.value,
              );
          }
      }
    }

    ancestor(record.ast, {
      ImportExpression(node, _state, ancestors) {
        if (
          node.source.type !== "Literal" ||
          typeof node.source.value !== "string" ||
          !node.source.value.startsWith(".")
        )
          return;
        const target = resolveModuleTarget(record.file, node.source.value);
        if (!records.has(target)) return;
        dependencyGraph.get(record.file).add(target);
        for (const name of dynamicImportNames(node, ancestors))
          addConsumedExport(consumedExports, target, name);
      },
    });
  }

  for (const entryPoint of entryPoints) {
    if (records.has(entryPoint))
      addConsumedExport(consumedExports, entryPoint, "default");
  }
  return { consumedExports, dependencyGraph };
}

function isScopeNode(node) {
  return [
    "Program",
    "BlockStatement",
    "CatchClause",
    "ForStatement",
    "ForInStatement",
    "ForOfStatement",
    "SwitchStatement",
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
    "ClassDeclaration",
    "ClassExpression",
  ].includes(node.type);
}

function collectPatternIdentifiers(pattern, callback) {
  if (!pattern) return;
  if (pattern.type === "Identifier") {
    callback(pattern);
    return;
  }
  if (pattern.type === "RestElement") {
    collectPatternIdentifiers(pattern.argument, callback);
    return;
  }
  if (pattern.type === "AssignmentPattern") {
    collectPatternIdentifiers(pattern.left, callback);
    return;
  }
  if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements)
      collectPatternIdentifiers(element, callback);
    return;
  }
  if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) {
      if (property.type === "RestElement")
        collectPatternIdentifiers(property.argument, callback);
      else collectPatternIdentifiers(property.value, callback);
    }
  }
}

function analyzeBindings(record, consumedExports) {
  const scopeByNode = new Map();
  const declarationIdentifiers = new Set();
  const bindings = [];

  function ensureScopes(ancestors) {
    let parent = null;
    for (const node of ancestors) {
      if (!isScopeNode(node)) continue;
      if (!scopeByNode.has(node))
        scopeByNode.set(node, { node, parent, bindings: new Map() });
      parent = scopeByNode.get(node);
    }
    return parent;
  }

  function nearestFunctionOrProgram(scope) {
    for (let current = scope; current; current = current.parent) {
      if (
        current.node.type === "Program" ||
        current.node.type === "FunctionDeclaration" ||
        current.node.type === "FunctionExpression" ||
        current.node.type === "ArrowFunctionExpression"
      )
        return current;
    }
    return scope;
  }

  function declare(identifier, scope, kind) {
    declarationIdentifiers.add(identifier);
    let binding = scope.bindings.get(identifier.name);
    if (!binding) {
      binding = {
        name: identifier.name,
        kind,
        line: lineOf(identifier),
        used: false,
        exportedNames: new Set(),
      };
      scope.bindings.set(identifier.name, binding);
      bindings.push(binding);
    }
    return binding;
  }

  function declareFunctionParameters(node, ancestors) {
    const functionScope = ensureScopes(ancestors);
    if (node.type === "FunctionExpression" && node.id)
      declare(node.id, functionScope, "function-name");
    for (const parameter of node.params)
      collectPatternIdentifiers(parameter, (identifier) =>
        declare(identifier, functionScope, "parameter"),
      );
  }

  ancestor(record.ast, {
    ImportDeclaration(node, _state, ancestors) {
      const programScope = ensureScopes(ancestors);
      for (const specifier of node.specifiers)
        declare(specifier.local, programScope, "import");
    },
    VariableDeclaration(node, _state, ancestors) {
      const lexicalScope = ensureScopes(ancestors);
      const targetScope =
        node.kind === "var"
          ? nearestFunctionOrProgram(lexicalScope)
          : lexicalScope;
      for (const item of node.declarations)
        collectPatternIdentifiers(item.id, (identifier) =>
          declare(identifier, targetScope, "variable"),
        );
    },
    FunctionDeclaration(node, _state, ancestors) {
      const parentScope = ensureScopes(ancestors.slice(0, -1));
      if (node.id) declare(node.id, parentScope, "function");
      declareFunctionParameters(node, ancestors);
    },
    FunctionExpression(node, _state, ancestors) {
      declareFunctionParameters(node, ancestors);
    },
    ArrowFunctionExpression(node, _state, ancestors) {
      declareFunctionParameters(node, ancestors);
    },
    ClassDeclaration(node, _state, ancestors) {
      const parentScope = ensureScopes(ancestors.slice(0, -1));
      if (node.id) declare(node.id, parentScope, "class");
    },
    ClassExpression(node, _state, ancestors) {
      const classScope = ensureScopes(ancestors);
      if (node.id) declare(node.id, classScope, "class-name");
    },
    CatchClause(node, _state, ancestors) {
      const catchScope = ensureScopes(ancestors);
      collectPatternIdentifiers(node.param, (identifier) =>
        declare(identifier, catchScope, "catch-parameter"),
      );
    },
  });

  const programScope = scopeByNode.get(record.ast);
  for (const entry of exportEntries(record)) {
    if (!entry.localName) continue;
    programScope?.bindings
      .get(entry.localName)
      ?.exportedNames.add(entry.exportedName);
  }

  function isReferenceIdentifier(node, ancestors) {
    if (declarationIdentifiers.has(node)) return false;
    const parent = ancestors.at(-2);
    if (!parent) return true;
    if (
      parent.type === "MemberExpression" &&
      parent.property === node &&
      !parent.computed
    )
      return false;
    if (
      ["MethodDefinition", "PropertyDefinition"].includes(parent.type) &&
      parent.key === node &&
      !parent.computed
    )
      return false;
    if (parent.type === "Property" && parent.key === node && !parent.computed)
      return parent.shorthand && parent.value === node;
    if (
      ["LabeledStatement", "BreakStatement", "ContinueStatement"].includes(
        parent.type,
      ) &&
      parent.label === node
    )
      return false;
    if (["ExportSpecifier", "ExportDefaultDeclaration"].includes(parent.type))
      return false;
    return true;
  }

  ancestor(record.ast, {
    Identifier(node, _state, ancestors) {
      if (!isReferenceIdentifier(node, ancestors)) return;
      let scope = ensureScopes(ancestors);
      while (scope) {
        const binding = scope.bindings.get(node.name);
        if (binding) {
          binding.used = true;
          return;
        }
        scope = scope.parent;
      }
    },
  });

  const consumed = consumedExports.get(record.file) ?? new Set();
  const diagnostics = [];
  for (const binding of bindings) {
    if (
      ["parameter", "catch-parameter", "function-name", "class-name"].includes(
        binding.kind,
      )
    )
      continue;
    const consumedExternally = [...binding.exportedNames].some(
      (name) => consumed.has("*") || consumed.has(name),
    );
    if (binding.used || consumedExternally) continue;
    const description =
      binding.kind === "import"
        ? `imported binding ${binding.name}`
        : `${binding.kind} ${binding.name}`;
    diagnostics.push(
      `${record.file}:${binding.line}: ${description} is never used`,
    );
  }
  return diagnostics;
}

function moduleLivenessDiagnostics(records, entryPoints = SOURCE_ENTRY_POINTS) {
  const { consumedExports, dependencyGraph } = collectModuleConsumption(
    records,
    entryPoints,
  );
  const diagnostics = [];
  const reachable = new Set();
  const pending = [...entryPoints].filter((file) => records.has(file));
  while (pending.length > 0) {
    const file = pending.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);
    for (const dependency of dependencyGraph.get(file) ?? [])
      if (dependency.startsWith("src/")) pending.push(dependency);
  }

  for (const file of records.keys()) {
    if (file.startsWith("src/") && !reachable.has(file))
      diagnostics.push(
        `${file}: source module is unreachable from the runtime entry points`,
      );
  }

  for (const record of records.values()) {
    diagnostics.push(...analyzeBindings(record, consumedExports));
    const consumed = consumedExports.get(record.file) ?? new Set();
    for (const entry of exportEntries(record)) {
      if (consumed.has("*") || consumed.has(entry.exportedName)) continue;
      diagnostics.push(
        `${record.file}:${entry.line}: export ${entry.exportedName} is not consumed by any module`,
      );
    }
  }
  return diagnostics;
}

/**
 * Validates module reachability and binding/export liveness for parsed sources.
 *
 * @param {Record<string, string>|Map<string, string>} moduleSources - Repository-relative module sources.
 * @param {Set<string>} entryPoints - Externally loaded source entry points.
 * @returns {string[]} Liveness diagnostics.
 */
export function validateModuleLiveness(
  moduleSources,
  entryPoints = SOURCE_ENTRY_POINTS,
) {
  const records = new Map();
  const sources =
    moduleSources instanceof Map
      ? moduleSources
      : Object.entries(moduleSources);
  for (const [file, source] of sources)
    records.set(file, parseModule(file, source));
  return moduleLivenessDiagnostics(records, entryPoints);
}

export async function checkModuleLiveness() {
  const records = await loadRecords();
  const errors = moduleLivenessDiagnostics(records);
  fail("Module liveness validation", errors);
  console.log("Module reachability, imports, bindings, and exports passed.");
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

/**
 * Validates that every property hydrated into PlayerProxy state is read, and
 * that every direct state read has an initial hydration owner.
 *
 * @param {string} file - Diagnostic source path.
 * @param {string} source - PlayerProxy source text.
 * @param {string[]} hydratedProperties - Root and Player properties loaded into state.
 * @returns {string[]} Hydration diagnostics.
 */
export function validateHydratedPropertyUsage(
  file,
  source,
  hydratedProperties,
) {
  const record = parseModule(file, source);
  const reads = new Map();
  ancestor(record.ast, {
    MemberExpression(node, _state, ancestors) {
      const path = memberPath(node);
      if (!path?.startsWith("this.state.")) return;
      const property = path.slice("this.state.".length);
      if (!property || property.includes(".")) return;

      const parent = ancestors.at(-2);
      if (
        (parent?.type === "AssignmentExpression" && parent.left === node) ||
        (parent?.type === "UpdateExpression" && parent.argument === node) ||
        (parent?.type === "UnaryExpression" &&
          parent.operator === "delete" &&
          parent.argument === node)
      )
        return;
      if (!reads.has(property)) reads.set(property, lineOf(node));
    },
  });

  const hydrated = new Set(hydratedProperties);
  const errors = [];
  for (const property of hydrated) {
    if (!reads.has(property))
      errors.push(
        `${file}: hydrated MPRIS property ${property} is never read from PlayerProxy state`,
      );
  }
  for (const [property, line] of reads) {
    if (!hydrated.has(property))
      errors.push(
        `${file}:${line}: PlayerProxy reads ${property} without hydrating it`,
      );
  }
  return errors;
}

export async function checkMprisPropertyHydration() {
  const records = await loadRecords();
  const playerProxy = records.get("src/shell/mpris/PlayerProxy.js");
  const errors = validateHydratedPropertyUsage(
    playerProxy.file,
    playerProxy.source,
    [...ROOT_PROPERTIES, ...PLAYER_PROPERTIES],
  );
  fail("MPRIS property hydration validation", errors);
  console.log("MPRIS property hydration matches PlayerProxy state reads.");
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
