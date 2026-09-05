/**
 * @file dev.mjs
 * @module scripts.dev
 *
 * Routes the small public pnpm command hub to validation, build, extension,
 * environment, and translation operations.
 */

import { join, resolve } from "node:path";

import { EXTENSION_UUID } from "../src/shared/project.js";
import {
  PACKAGE_FILENAME,
  PACKAGE_PATH,
  buildExtension,
  cleanReleaseWork,
  writePackageDigest,
} from "./dev/build.mjs";
import {
  checkExtensionContracts,
  checkSettingsContracts,
} from "./dev/contracts.mjs";
import { pathExists, rootPath, runCommand } from "./dev/files.mjs";
import {
  checkEntryPointContracts,
  checkImportsAndBoundaries,
  checkJavaScriptSyntax,
  checkRuntimeApiUsage,
} from "./dev/javascript.mjs";
import {
  EXTENSION_PACKAGE,
  checkPackage,
  checkPackageReproducibility,
} from "./dev/package.mjs";
import { checkPlaybackContracts } from "./dev/playback.mjs";

async function runGate(label, check) {
  console.log(`\n==> ${label}`);
  await check();
}

async function checkSource() {
  await checkJavaScriptSyntax();
  await checkImportsAndBoundaries();
  await checkRuntimeApiUsage();
  await checkEntryPointContracts();
}

async function checkDeclarativeContracts() {
  await checkExtensionContracts();
  await checkSettingsContracts();
  await checkPlaybackContracts();
}

function checkAssets() {
  runCommand("parsed assets", "python3", [
    "scripts/dev/assets.py",
    "--check-resources",
  ]);
  runCommand("development script syntax", "bash", [
    "-n",
    "scripts/development.sh",
  ]);
}

async function checkRuntime() {
  const gates = [
    ["source", checkSource],
    ["behavior", () => runCommand("tests", process.execPath, ["--test"])],
    ["declarative contracts", checkDeclarativeContracts],
    ["declarative assets", checkAssets],
  ];
  for (const [label, check] of gates) await runGate(label, check);
}

async function checkDevelopment() {
  await checkRuntime();
  await runGate("formatting", () =>
    runCommand(
      "Prettier",
      process.execPath,
      [rootPath("node_modules/prettier/bin/prettier.cjs"), "--check", "."],
      { quiet: true },
    ),
  );
  console.log("\nDevelopment checks passed.");
}

async function checkNativeCompilation() {
  await runGate("native GNOME/gettext validation", () =>
    runCommand(
      "GLib, GIO, and gettext",
      "python3",
      ["scripts/dev/assets.py", "--check-native"],
      { quiet: true },
    ),
  );
}

async function checkDependencies() {
  await runGate("frozen dependency state", () =>
    runCommand(
      "pnpm frozen install",
      "pnpm",
      ["install", "--frozen-lockfile"],
      {
        quiet: true,
      },
    ),
  );
  await runGate("dependency advisories", () =>
    runCommand("pnpm audit", "pnpm", ["audit", "--audit-level=high"], {
      quiet: true,
    }),
  );
  await runGate("registry signatures", () =>
    runCommand("pnpm audit signatures", "pnpm", ["audit", "signatures"], {
      quiet: true,
    }),
  );
}

async function checkAll() {
  await checkDependencies();
  await checkDevelopment();
  await checkNativeCompilation();
  console.log("\nAll source, dependency, and native gates passed.");
}

function formatShexliFinding(finding) {
  const severity = finding?.severity ?? "unknown";
  const rule = finding?.rule_id ?? "unknown-rule";
  const message = finding?.message ?? "No finding message provided.";
  const evidence = Array.isArray(finding?.evidence)
    ? finding.evidence[0]
    : null;
  const location = evidence?.path
    ? `${evidence.path}${evidence.line == null ? "" : `:${evidence.line}`}`
    : null;
  return `${rule} [${severity}] ${message}${location ? ` (${location})` : ""}`;
}

async function checkShexli(packagePath = EXTENSION_PACKAGE) {
  const resolvedPath = resolve(rootPath("."), packagePath);
  if (!(await pathExists(resolvedPath)))
    throw new Error(
      `Shexli package not found: ${packagePath}. Run a build first.`,
    );

  const output = runCommand(
    "Shexli EGO analysis",
    "shexli",
    [resolvedPath, "--format", "json"],
    { capture: true },
  );

  let report;
  try {
    report = JSON.parse(output);
  } catch {
    throw new Error("Shexli returned invalid JSON output.");
  }

  if (!Array.isArray(report?.findings))
    throw new Error("Shexli JSON report does not contain a findings array.");

  const errors = report.findings.filter(
    (finding) => finding?.severity === "error",
  );
  const review = report.findings.filter(
    (finding) => finding?.severity !== "error",
  );

  if (review.length > 0) {
    console.log(
      `Shexli reported ${review.length} non-blocking reviewer finding${review.length === 1 ? "" : "s"}:`,
    );
    for (const finding of review)
      console.log(`- ${formatShexliFinding(finding)}`);
  }

  if (errors.length > 0)
    throw new Error(
      `Shexli found ${errors.length} blocking EGO error${errors.length === 1 ? "" : "s"}:\n${errors
        .map((finding) => `- ${formatShexliFinding(finding)}`)
        .join("\n")}`,
    );

  console.log(
    `Shexli EGO analysis passed with ${report.findings.length} total finding${report.findings.length === 1 ? "" : "s"} and no blocking errors.`,
  );
  return report;
}

async function buildDebug() {
  await checkDevelopment();
  await checkNativeCompilation();
  const packagePath = await buildExtension("debug");
  await checkPackage(packagePath);
  return packagePath;
}

async function buildForce() {
  return buildExtension("force");
}

async function buildRelease() {
  await checkAll();
  await cleanReleaseWork();
  try {
    const packagePath = await buildExtension("release");
    await checkPackage(packagePath);

    const reproductionPackage = await buildExtension("release", {
      outputPath: join(
        rootPath("dist/.release-tmp/reproduction"),
        PACKAGE_FILENAME,
      ),
    });
    checkPackageReproducibility(packagePath, reproductionPackage);
    await checkShexli(packagePath);

    const digest = await writePackageDigest(packagePath);
    console.log(`\nRelease SHA-256: ${digest}`);
    console.log(`Release package: ${PACKAGE_PATH}`);
    return packagePath;
  } finally {
    await cleanReleaseWork();
  }
}

async function runBuild(profile) {
  if (profile === "debug") return buildDebug();
  if (profile === "force") return buildForce();
  if (profile === "release") return buildRelease();
  throw new Error("Build profile must be 'debug', 'force', or 'release'.");
}

function requireNoArgs(args, command) {
  if (args.length > 0)
    throw new Error(
      `${command} does not accept a build selector. It always uses ${PACKAGE_PATH}.`,
    );
}

async function installExtension() {
  const packagePath = rootPath(PACKAGE_PATH);
  if (!(await pathExists(packagePath)))
    throw new Error(
      `Package not found: ${PACKAGE_PATH}. Run pnpm build:debug, pnpm build:force, or pnpm build:release first.`,
    );
  runCommand("install extension", "gnome-extensions", [
    "install",
    "--force",
    packagePath,
  ]);
  console.log(
    "Installed the current build. GNOME Shell will discover a newly installed extension in the next Shell session.",
  );
  return packagePath;
}

async function runExtensionCommand(action, args) {
  if (action === "install") {
    requireNoArgs(args, "ext:install");
    await installExtension();
    return;
  }
  if (action === "remove") {
    runCommand("remove extension", "gnome-extensions", [
      "uninstall",
      EXTENSION_UUID,
    ]);
    return;
  }
  if (["enable", "disable", "prefs"].includes(action)) {
    runCommand(`${action} extension`, "gnome-extensions", [
      action,
      EXTENSION_UUID,
    ]);
    return;
  }
  if (action === "reinstall") {
    requireNoArgs(args, "ext:reinstall");
    await buildDebug();
    await installExtension();
    console.log(
      "Start a fresh Shell session before enabling a newly installed extension; pnpm shell:debug provides the supported nested development session.",
    );
    return;
  }
  if (action === "upload") {
    const packagePath = await buildRelease();
    runCommand("upload release to EGO", "gnome-extensions", [
      "upload",
      "--accept-tos",
      "--user",
      "WSTxda",
      ...args,
      packagePath,
    ]);
    return;
  }
  throw new Error(
    "Extension action must be install, remove, enable, disable, prefs, reinstall, or upload.",
  );
}

function updateTranslations() {
  runCommand("update translations", "python3", [
    "scripts/dev/assets.py",
    "--update-translations",
  ]);
}

const [command = "check", subcommand, ...args] = process.argv.slice(2);

try {
  if (command === "check") {
    if (subcommand === undefined) await checkDevelopment();
    else if (subcommand === "all") await checkAll();
    else if (subcommand === "package") {
      requireNoArgs(args, "check:package");
      await checkPackage();
    } else if (subcommand === "shexli") {
      requireNoArgs(args, "check:shexli");
      await checkShexli();
    } else throw new Error("Check target must be all, package, or shexli.");
  } else if (command === "test")
    runCommand("tests", process.execPath, ["--test"]);
  else if (command === "lint") await checkSource();
  else if (command === "build") await runBuild(subcommand);
  else if (command === "ext") await runExtensionCommand(subcommand, args);
  else if (command === "env" && subcommand === "doctor")
    runCommand("development environment", "bash", [
      "scripts/development.sh",
      "doctor",
    ]);
  else if (command === "shell" && subcommand === "debug")
    runCommand("GNOME Shell debug session", "bash", [
      "scripts/development.sh",
      "debug",
    ]);
  else if (command === "translations") updateTranslations();
  else
    throw new Error(
      "Unknown command. Use check, test, lint, build, ext, env doctor, shell debug, or translations.",
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
