/**
 * @file extractTranslations.mjs
 * @module scripts.dev.extractTranslations
 *
 * Extracts literal JavaScript gettext calls from the shared Acorn module cache.
 *
 * The parsed fallback keeps source/catalog parity testable without GNU gettext;
 * the native release gate still runs xgettext and msgfmt when they are available.
 */

import { simple } from "acorn-walk";

import { getJavaScriptRecords } from "./javascript.mjs";

function literalString(node) {
  return node?.type === "Literal" && typeof node.value === "string"
    ? node.value
    : null;
}

const messages = new Map();

function addMessage(msgid, reference, msgidPlural = null) {
  if (!msgid) return;
  const current = messages.get(msgid) ?? {
    msgid,
    msgidPlural: null,
    references: [],
  };
  if (msgidPlural) current.msgidPlural = msgidPlural;
  if (!current.references.includes(reference))
    current.references.push(reference);
  messages.set(msgid, current);
}

for (const record of (await getJavaScriptRecords()).values()) {
  if (!record.file.startsWith("src/") || !record.file.endsWith(".js")) continue;
  simple(record.ast, {
    CallExpression(node) {
      if (node.callee.type !== "Identifier") return;
      const reference = `${record.file}:${node.loc?.start.line ?? 1}`;
      if (node.callee.name === "_")
        addMessage(literalString(node.arguments[0]), reference);
      else if (node.callee.name === "ngettext")
        addMessage(
          literalString(node.arguments[0]),
          reference,
          literalString(node.arguments[1]),
        );
      else if (node.callee.name === "C_")
        addMessage(literalString(node.arguments[1]), reference);
    },
  });
}

console.log(JSON.stringify([...messages.values()]));
