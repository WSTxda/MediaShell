/**
 * @file dev.mjs
 * @module scripts.dev
 *
 * Runs MediaShell development validation, audits, and package inspection.
 *
 * Runtime checks guard executable contracts used by GNOME Shell. Formatting
 * and organization audits remain explicit developer tools and do not make a
 * production build fail for non-behavioral preferences.
 */

import { runAudit } from "./dev/audit.mjs";
import {
  checkExtensionContracts,
  checkSettingsContracts,
} from "./dev/contracts.mjs";
import { rootPath, runCommand } from "./dev/files.mjs";
import {
  checkEntryPointContracts,
  checkImportsAndBoundaries,
  checkJavaScriptSyntax,
  checkSourceStructure,
} from "./dev/javascript.mjs";
import { EXTENSION_PACKAGE, checkPackage } from "./dev/package.mjs";

async function runCheck(label, check) {
  console.log(`\n==> ${label}`);
  await check();
}

async function checkRuntime() {
  const checks = [
    ["JavaScript syntax", checkJavaScriptSyntax],
    ["imports and process boundaries", checkImportsAndBoundaries],
    ["runtime API safety", checkSourceStructure],
    ["entry-point lifecycle", checkEntryPointContracts],
    ["extension metadata", checkExtensionContracts],
    ["settings and UI contracts", checkSettingsContracts],
  ];

  for (const [label, check] of checks) await runCheck(label, check);

  runCommand("unit tests", process.execPath, ["--test"]);
  runCommand("parsed assets and translations", "python3", [
    "scripts/dev/assets.py",
  ]);
  runCommand("development script syntax", "bash", [
    "-n",
    "scripts/development.sh",
  ]);

  console.log(`\nAll ${checks.length + 3} runtime validation groups passed.`);
}

async function checkDevelopment() {
  await checkRuntime();
  runCommand("formatting", process.execPath, [
    rootPath("node_modules/prettier/bin/prettier.cjs"),
    "--check",
    ".",
  ]);
  await runCheck("organization audit", runAudit);
  console.log("\nDevelopment checks passed.");
}

const [command = "check", argument] = process.argv.slice(2);

try {
  if (command === "check") await checkDevelopment();
  else if (command === "runtime") await checkRuntime();
  else if (command === "audit")
    await runAudit({ strict: argument === "--strict" });
  else if (command === "package")
    await checkPackage(argument ?? EXTENSION_PACKAGE);
  else
    throw new Error(
      `Unknown command: ${command}\n` +
        "Use 'check', 'runtime', 'audit [--strict]', or 'package [zip]'.",
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
