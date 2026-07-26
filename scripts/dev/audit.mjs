/**
 * @file audit.mjs
 * @module scripts.dev.audit
 *
 * Provides advisory repository diagnostics for maintainers.
 *
 * Audits describe organization and documentation drift without joining the
 * runtime build gate. Maintainers can opt into strict mode when preparing a
 * cleanup change.
 */

import {
  inspectModuleDocumentationAndNaming,
  inspectSourceConventions,
} from "./javascript.mjs";

/**
 * Collects non-runtime diagnostics that are useful during refactors.
 *
 * @returns {Promise<string[]>} Human-readable diagnostics.
 */
async function collectAuditDiagnostics() {
  const diagnostics = await Promise.all([
    inspectModuleDocumentationAndNaming(),
    inspectSourceConventions(),
  ]);
  return diagnostics.flat();
}

/**
 * Prints advisory diagnostics and optionally fails in explicitly strict mode.
 *
 * @param {{strict?: boolean}} options - Audit behavior.
 * @returns {Promise<string[]>} Collected diagnostics.
 */
export async function runAudit({ strict = false } = {}) {
  const diagnostics = await collectAuditDiagnostics();
  if (diagnostics.length === 0) {
    console.log("No organization or module-documentation drift found.");
    return diagnostics;
  }

  console.log(
    `Found ${diagnostics.length} advisory organization diagnostic(s):`,
  );
  for (const diagnostic of diagnostics) console.log(`- ${diagnostic}`);

  if (strict)
    throw new Error(
      "Strict repository audit failed. Resolve the diagnostics listed above.",
    );
  return diagnostics;
}
