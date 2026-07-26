/**
 * @file dev.mjs
 * @module scripts.dev
 *
 * Runs MediaShell validation through a small set of executable release gates.
 *
 * Runtime gates protect source, lifecycle, declarative assets, translations,
 * and tests. Formatting and organization remain explicit developer diagnostics.
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
  checkModuleLiveness,
  checkMprisPropertyHydration,
  checkSourceStructure,
} from "./dev/javascript.mjs";
import { EXTENSION_PACKAGE, checkPackage } from "./dev/package.mjs";
import { checkPlaybackContracts } from "./dev/playback.mjs";

async function runGate(label, check) {
  console.log(`\n==> ${label}`);
  await check();
}

async function checkSourceGraph() {
  await checkJavaScriptSyntax();
  await checkImportsAndBoundaries();
  await checkModuleLiveness();
}

async function checkRuntimeSafety() {
  await checkMprisPropertyHydration();
  await checkSourceStructure();
  await checkEntryPointContracts();
  runCommand("behavioral contracts", process.execPath, ["--test"]);
}

async function checkDeclarativeContracts() {
  await checkExtensionContracts();
  await checkSettingsContracts();
  await checkPlaybackContracts();
}

function checkAssetsAndTranslations() {
  runCommand("parsed assets", "python3", [
    "scripts/dev/assets.py",
    "--check-resources",
  ]);
  runCommand("translations", "python3", [
    "scripts/dev/assets.py",
    "--check-translations",
  ]);
  runCommand("development script syntax", "bash", [
    "-n",
    "scripts/development.sh",
  ]);
}

async function checkRuntime() {
  const gates = [
    ["source graph", checkSourceGraph],
    ["runtime safety", checkRuntimeSafety],
    ["declarative contracts", checkDeclarativeContracts],
    ["assets and translations", checkAssetsAndTranslations],
  ];
  for (const [label, check] of gates) await runGate(label, check);
  console.log(`\nAll ${gates.length} runtime validation gates passed.`);
}

async function checkNativeCompilation() {
  await runGate("native compilation", () =>
    runCommand("GNOME and gettext toolchain", "python3", [
      "scripts/dev/assets.py",
      "--check-native",
    ]),
  );
  console.log("\nNative compilation gate passed.");
}

async function checkDevelopment() {
  await checkRuntime();
  runCommand("formatting", process.execPath, [
    rootPath("node_modules/prettier/bin/prettier.cjs"),
    "--check",
    ".",
  ]);
  await runGate("organization audit", runAudit);
  console.log("\nDevelopment checks passed.");
}

const [command = "check", argument] = process.argv.slice(2);

try {
  if (command === "check") await checkDevelopment();
  else if (command === "runtime") await checkRuntime();
  else if (command === "native") await checkNativeCompilation();
  else if (command === "audit")
    await runAudit({ strict: argument === "--strict" });
  else if (command === "package")
    await checkPackage(argument ?? EXTENSION_PACKAGE);
  else
    throw new Error(
      `Unknown command: ${command}\n` +
        "Use 'check', 'runtime', 'native', 'audit [--strict]', or 'package [zip]'.",
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
