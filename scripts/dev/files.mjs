/**
 * @file files.mjs
 * @module scripts.dev.files
 *
 * Provides repository path, collection, process, and failure primitives for checks.
 *
 * Validation modules share one deterministic file traversal and one command
 * runner so ignored directories, diagnostics, and exit behavior remain aligned.
 */

import { spawnSync } from "node:child_process";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "dist",
  "node_modules",
  "__pycache__",
]);

export function rootPath(path) {
  return join(ROOT, path);
}

export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function read(path) {
  return readFile(rootPath(path), "utf8");
}

export async function collect(directory, include) {
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

export async function collectJavaScript(directory) {
  return collect(directory, (path) => [".js", ".mjs"].includes(extname(path)));
}

export function fail(label, errors) {
  if (errors.length === 0) return;
  throw new Error(
    `${label} failed:\n${errors.map((error) => `- ${error}`).join("\n")}`,
  );
}

export function runCommand(label, command, args, options = {}) {
  if (!options.quiet) console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? "pipe" : "inherit",
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
  });

  if (result.error)
    throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = options.capture
      ? [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
      : "";
    const outcome =
      result.status !== null
        ? `exited with status ${result.status}`
        : result.signal
          ? `was terminated by signal ${result.signal}`
          : "exited without a status";
    throw new Error(`${label} ${outcome}${detail ? `:\n${detail}` : ""}`);
  }

  return options.capture ? result.stdout : "";
}

export function readAssetManifest() {
  const output = runCommand(
    "parsed asset manifest",
    "python3",
    ["scripts/dev/assets.py", "--manifest"],
    { capture: true, quiet: true },
  );
  return JSON.parse(output);
}
