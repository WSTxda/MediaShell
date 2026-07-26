/**
 * @file playbackJavaScript.mjs
 * @module scripts.dev.playbackJavaScript
 *
 * Validates AST-level playback execution, state ownership, and renderer teardown.
 *
 * The checks reuse the shared Acorn records so source syntax, boundaries, and
 * playback ownership are evaluated from one parsed representation.
 */

import { ancestor, simple } from "acorn-walk";

import { memberPath } from "./javascript.mjs";

const PLAYBACK_BOUNDARY_FILES = Object.freeze([
  "src/shell/ui/popup/PopupPlaybackControls.js",
  "src/shell/ui/topBar/TopBarPlaybackControls.js",
  "src/shell/ExtensionController.js",
]);

const PLAYBACK_RENDERER_FILES = Object.freeze([
  "src/shell/ui/popup/PopupPlaybackControls.js",
  "src/shell/ui/topBar/TopBarPlaybackControls.js",
]);

const DIRECT_PLAYBACK_METHODS = new Set([
  "toggleShuffle",
  "seek",
  "previous",
  "play",
  "pause",
  "playPause",
  "stop",
  "next",
  "toggleLoop",
  "setPlaybackRate",
]);

function methodName(method) {
  if (method.computed) return null;
  if (["Identifier", "PrivateIdentifier"].includes(method.key.type))
    return method.key.name;
  if (method.key.type === "Literal") return String(method.key.value);
  return null;
}

function findOwnedClass(record) {
  for (const node of record.ast.body) {
    if (
      node.type === "ExportDefaultDeclaration" &&
      node.declaration.type === "ClassDeclaration"
    )
      return node.declaration;
  }
  return null;
}

function buildMethodFacts(classNode) {
  const facts = new Map();
  for (const method of classNode.body.body) {
    if (method.type !== "MethodDefinition") continue;
    const name = methodName(method);
    if (!name) continue;
    const state = {
      calls: new Set(),
      clickedConnects: 0,
      unstoredClickedConnects: 0,
      disconnects: 0,
      actorDestroys: 0,
      mprisMethodRefs: new Set(),
      variantSignatures: new Set(),
    };

    ancestor(method.value.body, {
      CallExpression(node, _walkerState, ancestors) {
        const path = memberPath(node.callee);
        if (path?.startsWith("this."))
          state.calls.add(path.slice("this.".length));
        if (
          path?.endsWith(".connect") &&
          node.arguments[0]?.type === "Literal" &&
          node.arguments[0].value === "clicked"
        ) {
          state.clickedConnects++;
          const parent = ancestors.at(-2);
          const isStored =
            (parent?.type === "AssignmentExpression" &&
              parent.right === node) ||
            (parent?.type === "VariableDeclarator" && parent.init === node);
          if (!isStored) state.unstoredClickedConnects++;
        }
        if (path?.endsWith(".disconnect")) state.disconnects++;
        if (path?.endsWith(".destroy")) state.actorDestroys++;
      },
      MemberExpression(node) {
        const path = memberPath(node);
        if (path?.startsWith("MprisPlayerMethods."))
          state.mprisMethodRefs.add(path.split(".").at(-1));
      },
      NewExpression(node) {
        if (
          memberPath(node.callee) === "GLib.Variant" &&
          node.arguments[0]?.type === "Literal" &&
          typeof node.arguments[0].value === "string"
        )
          state.variantSignatures.add(node.arguments[0].value);
      },
    });
    facts.set(name, state);
  }
  return facts;
}

function reachableMethods(methodFacts, root) {
  const reachable = new Set();
  const pending = [root];
  while (pending.length > 0) {
    const method = pending.pop();
    if (reachable.has(method) || !methodFacts.has(method)) continue;
    reachable.add(method);
    for (const called of methodFacts.get(method).calls) pending.push(called);
  }
  return reachable;
}

/**
 * Validates one playback renderer's signal and actor teardown path.
 *
 * @param {object} record - Parsed JavaScript module record.
 * @returns {string[]} Lifecycle diagnostics.
 */
export function validatePlaybackRendererLifecycle(record) {
  const errors = [];
  const classNode = findOwnedClass(record);
  if (!classNode) return [`${record.file}: default renderer class is missing`];
  const facts = buildMethodFacts(classNode);
  const clickedConnects = [...facts.values()].reduce(
    (count, state) => count + state.clickedConnects,
    0,
  );
  const unstored = [...facts.values()].reduce(
    (count, state) => count + state.unstoredClickedConnects,
    0,
  );
  if (clickedConnects === 0)
    errors.push(`${record.file}: playback renderer has no clicked signal`);
  if (unstored > 0)
    errors.push(
      `${record.file}: clicked signal IDs must be retained for teardown`,
    );

  const reachable = reachableMethods(facts, "destroy");
  let disconnects = 0;
  let actorDestroys = 0;
  for (const name of reachable) {
    disconnects += facts.get(name).disconnects;
    actorDestroys += facts.get(name).actorDestroys;
  }
  if (disconnects === 0)
    errors.push(
      `${record.file}: destroy path does not disconnect control signals`,
    );
  if (actorDestroys === 0)
    errors.push(`${record.file}: destroy path does not destroy control actors`);
  return errors;
}

/**
 * Validates one runtime boundary module for executor ownership.
 *
 * @param {object} record - Parsed JavaScript module record.
 * @returns {string[]} Boundary diagnostics.
 */
export function validatePlaybackBoundaryRecord(record) {
  const errors = [];
  let importsExecutor = false;
  let callsExecutor = false;

  for (const node of record.ast.body) {
    if (node.type !== "ImportDeclaration") continue;
    if (String(node.source.value).endsWith("/playbackControlExecutor.js")) {
      importsExecutor = node.specifiers.some(
        (specifier) =>
          specifier.type === "ImportSpecifier" &&
          (specifier.imported.name ?? specifier.imported.value) ===
            "executePlaybackControlAction",
      );
    }
    if (String(node.source.value).endsWith("/shared/constants/dbus.js"))
      errors.push(
        `${record.file}: playback boundary imports D-Bus vocabulary directly`,
      );
  }

  simple(record.ast, {
    CallExpression(node) {
      const path = memberPath(node.callee);
      const calledMethod = path?.split(".").at(-1);
      if (path === "executePlaybackControlAction") callsExecutor = true;
      if (DIRECT_PLAYBACK_METHODS.has(calledMethod))
        errors.push(
          `${record.file}:${node.loc?.start.line ?? 1}: direct playback call ` +
            `${calledMethod}() bypasses the shared executor`,
        );
    },
  });

  if (!importsExecutor)
    errors.push(`${record.file}: shared playback executor import is missing`);
  if (!callsExecutor)
    errors.push(`${record.file}: shared playback executor is not called`);
  return errors;
}

function validatePlayerProxySeekMethods(record) {
  const errors = [];
  const classNode = findOwnedClass(record);
  if (!classNode) return [`${record.file}: PlayerProxy class is missing`];
  const facts = buildMethodFacts(classNode);
  const seek = facts.get("seek");
  const setPosition = facts.get("setPosition");
  if (!seek) errors.push(`${record.file}: seek() is missing`);
  if (!setPosition) errors.push(`${record.file}: setPosition() is missing`);
  if (seek) {
    if (!seek.mprisMethodRefs.has("SEEK"))
      errors.push(
        `${record.file}: seek() does not use MprisPlayerMethods.SEEK`,
      );
    if (seek.mprisMethodRefs.has("SET_POSITION"))
      errors.push(`${record.file}: seek() must not use SetPosition`);
    if (!seek.variantSignatures.has("(x)"))
      errors.push(`${record.file}: seek() must send a signed int64 tuple`);
  }
  if (setPosition) {
    if (!setPosition.mprisMethodRefs.has("SET_POSITION"))
      errors.push(`${record.file}: setPosition() does not use SET_POSITION`);
    if (setPosition.mprisMethodRefs.has("SEEK"))
      errors.push(`${record.file}: setPosition() must not use Seek`);
    if (!setPosition.variantSignatures.has("(ox)"))
      errors.push(
        `${record.file}: setPosition() must send object-path and int64`,
      );
  }
  for (const forbidden of ["seekBackward", "seekForward"]) {
    if (facts.has(forbidden))
      errors.push(`${record.file}: ${forbidden}() duplicates generic seek()`);
  }
  return errors;
}

function validateAbsoluteRelativeSeekOwnership(records) {
  const errors = [];
  const allowedSeekCaller = "src/shell/mpris/playbackControlExecutor.js";
  const allowedSetPositionCaller = "src/shell/ui/popup/PopupProgressBar.js";
  let executorDispatchesSeek = false;
  let progressBarSetsPosition = false;

  for (const record of records.values()) {
    if (!record.file.startsWith("src/")) continue;
    simple(record.ast, {
      CallExpression(node) {
        const path = memberPath(node.callee);
        const calledMethod = path?.split(".").at(-1);
        const dispatchesSeek =
          record.file === allowedSeekCaller &&
          path === "executeDelegate" &&
          node.arguments[1]?.type === "Literal" &&
          node.arguments[1].value === "seek";
        if (dispatchesSeek) executorDispatchesSeek = true;
        if (calledMethod === "seek" && !dispatchesSeek)
          errors.push(
            `${record.file}:${node.loc?.start.line ?? 1}: relative seek must ` +
              "be dispatched by playbackControlExecutor",
          );
        if (calledMethod === "setPosition") {
          if (record.file === allowedSetPositionCaller)
            progressBarSetsPosition = true;
          else
            errors.push(
              `${record.file}:${node.loc?.start.line ?? 1}: absolute ` +
                "SetPosition must be owned by PopupProgressBar",
            );
        }
      },
      MemberExpression(node) {
        const path = memberPath(node);
        if (
          [
            "MprisPlayerMethods.SEEK",
            "MprisPlayerMethods.SET_POSITION",
          ].includes(path) &&
          record.file !== "src/shell/mpris/PlayerProxy.js" &&
          record.file !== "src/shared/constants/dbus.js"
        )
          errors.push(
            `${record.file}:${node.loc?.start.line ?? 1}: direct MPRIS seek ` +
              "vocabulary is outside PlayerProxy",
          );
      },
    });
  }

  if (!executorDispatchesSeek)
    errors.push("playbackControlExecutor does not dispatch relative seek");
  if (!progressBarSetsPosition)
    errors.push("PopupProgressBar does not own absolute SetPosition");
  return errors;
}

function validatePlayerProxyOwnerHandoff(records) {
  const errors = [];
  const playerProxy = records.get("src/shell/mpris/PlayerProxy.js");
  const registry = records.get("src/shell/mpris/MediaAppRegistry.js");
  if (!playerProxy || !registry) return errors;

  const classNode = findOwnedClass(playerProxy);
  const facts = classNode ? buildMethodFacts(classNode) : new Map();
  const adoptOwner = facts.get("adoptCurrentNameOwner");
  const resetOwnerState = facts.get("resetStateForOwnerChange");
  const callProxy = facts.get("#callProxy") ?? facts.get("callProxy");
  if (!adoptOwner)
    errors.push(`${playerProxy.file}: owner-adoption method is missing`);
  else if (!adoptOwner.calls.has("resetStateForOwnerChange"))
    errors.push(
      `${playerProxy.file}: owner adoption does not reset stale MPRIS state`,
    );
  if (
    !resetOwnerState ||
    ![...resetOwnerState.calls].some((call) =>
      call.endsWith(".resetForOwnerChange"),
    )
  )
    errors.push(
      `${playerProxy.file}: owner reset does not invalidate position reads`,
    );
  if (!callProxy?.calls.has("readCurrentNameOwner"))
    errors.push(
      `${playerProxy.file}: D-Bus calls do not snapshot the current owner`,
    );
  if (!callProxy?.calls.has("adoptCurrentNameOwner"))
    errors.push(
      `${playerProxy.file}: D-Bus calls do not adopt a replacement owner`,
    );

  let registryAdoptsOwner = false;
  simple(registry.ast, {
    CallExpression(node) {
      if (memberPath(node.callee)?.endsWith(".adoptCurrentNameOwner"))
        registryAdoptsOwner = true;
    },
  });
  if (!registryAdoptsOwner)
    errors.push(
      `${registry.file}: owner reconciliation does not refresh PlayerProxy ownership`,
    );
  return errors;
}

function importedNames(record, sourceSuffix) {
  const names = new Set();
  for (const node of record.ast.body) {
    if (
      node.type !== "ImportDeclaration" ||
      !String(node.source.value).endsWith(sourceSuffix)
    )
      continue;
    for (const specifier of node.specifiers) {
      if (specifier.type !== "ImportSpecifier") continue;
      names.add(specifier.imported.name ?? specifier.imported.value);
    }
  }
  return names;
}

function validatePositionTrackerOwnership(records) {
  const errors = [];
  const record = records.get("src/shell/mpris/PositionTracker.js");
  if (!record) return ["src/shell/mpris/PositionTracker.js: module is missing"];

  const playbackPositionImports = importedNames(
    record,
    "/shared/utils/playbackPosition.js",
  );
  if (!playbackPositionImports.has("resolvePlaybackPositionEstimate"))
    errors.push(
      `${record.file}: position projection is not delegated to the shared resolver`,
    );

  let callsEstimateResolver = false;
  let guardsRefreshGeneration = false;
  const forbiddenSources = [];
  simple(record.ast, {
    BinaryExpression(node) {
      if (node.operator !== "!==") return;
      const leftPath = memberPath(node.left);
      const rightPath = memberPath(node.right);
      if (
        (leftPath === "refreshGeneration" &&
          rightPath === "this.positionRefreshGeneration") ||
        (rightPath === "refreshGeneration" &&
          leftPath === "this.positionRefreshGeneration")
      )
        guardsRefreshGeneration = true;
    },
    CallExpression(node) {
      const path = memberPath(node.callee);
      if (path === "resolvePlaybackPositionEstimate")
        callsEstimateResolver = true;
      if (["GLib.timeout_add", "GLib.idle_add"].includes(path))
        forbiddenSources.push(node.loc?.start.line ?? 1);
    },
  });

  if (!callsEstimateResolver)
    errors.push(`${record.file}: shared position resolver is not called`);
  if (!guardsRefreshGeneration)
    errors.push(
      `${record.file}: late position reads are not generation-guarded`,
    );
  for (const line of forbiddenSources)
    errors.push(
      `${record.file}:${line}: position tracking must not poll with a GLib source`,
    );
  return errors;
}

function validateMediaAppRegistryPolicy(records) {
  const errors = [];
  const record = records.get("src/shell/mpris/MediaAppRegistry.js");
  if (!record)
    return ["src/shell/mpris/MediaAppRegistry.js: module is missing"];

  const policyImports = importedNames(record, "/mediaAppSelectionPolicy.js");
  for (const requiredImport of [
    "chooseReconciledMediaApp",
    "orderMediaAppsDeterministically",
  ]) {
    if (!policyImports.has(requiredImport))
      errors.push(
        `${record.file}: selection policy import ${requiredImport} is missing`,
      );
  }

  const calls = new Set();
  simple(record.ast, {
    CallExpression(node) {
      const path = memberPath(node.callee);
      if (path) calls.add(path);
    },
  });
  for (const requiredCall of [
    "chooseReconciledMediaApp",
    "orderMediaAppsDeterministically",
  ]) {
    if (!calls.has(requiredCall))
      errors.push(
        `${record.file}: selection policy ${requiredCall} is not applied`,
      );
  }
  if (![...calls].some((call) => call.endsWith(".adoptCurrentNameOwner")))
    errors.push(
      `${record.file}: owner reconciliation does not refresh PlayerProxy ownership`,
    );
  return errors;
}

/**
 * Validates AST-level playback execution and teardown boundaries.
 *
 * @param {Map<string, object>} records - Parsed JavaScript records.
 * @returns {string[]} Boundary and lifecycle diagnostics.
 */
export function validatePlaybackJavaScriptContracts(records) {
  const errors = [];
  for (const file of PLAYBACK_BOUNDARY_FILES) {
    const record = records.get(file);
    if (!record) errors.push(`${file}: playback boundary module is missing`);
    else errors.push(...validatePlaybackBoundaryRecord(record));
  }
  for (const file of PLAYBACK_RENDERER_FILES) {
    const record = records.get(file);
    if (record) errors.push(...validatePlaybackRendererLifecycle(record));
  }

  const playerProxy = records.get("src/shell/mpris/PlayerProxy.js");
  if (!playerProxy)
    errors.push("src/shell/mpris/PlayerProxy.js: module is missing");
  else errors.push(...validatePlayerProxySeekMethods(playerProxy));
  errors.push(...validateAbsoluteRelativeSeekOwnership(records));
  errors.push(...validatePlayerProxyOwnerHandoff(records));
  errors.push(...validatePositionTrackerOwnership(records));
  errors.push(...validateMediaAppRegistryPolicy(records));
  return errors;
}
