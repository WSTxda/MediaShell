/**
 * @file package.mjs
 * @module scripts.dev.package
 *
 * Validates the generated GNOME Shell extension archive and runtime-only shape.
 *
 * Python's zipfile parser supplies entry metadata and UTF-8 runtime sources so
 * unsafe paths, links, duplicate entries, missing files, metadata drift, and
 * accidentally shipped repository assets are detected before release.
 */

import { spawnSync } from "node:child_process";
import { extname, relative, resolve } from "node:path";

import { parse } from "acorn";

import { EXTENSION_UUID } from "../../src/shared/constants/project.js";
import { ROOT, collect, fail, pathExists, read } from "./files.mjs";
import { validateExtensionMetadata } from "./metadata.mjs";

export const EXTENSION_PACKAGE = `dist/builds/${EXTENSION_UUID}.shell-extension.zip`;

function readZip(path) {
  const script = String.raw`
import json
import stat
import sys
import zipfile

entries = []
contents = {}
text_suffixes = (".js", ".json", ".xml", ".ui", ".css", ".txt", ".md")

with zipfile.ZipFile(sys.argv[1]) as archive:
    bad_entry = archive.testzip()
    if bad_entry:
        raise RuntimeError(f"CRC check failed for {bad_entry}")
    for info in archive.infolist():
        name = info.filename
        mode = info.external_attr >> 16
        entries.append({
            "name": name,
            "size": info.file_size,
            "compressed_size": info.compress_size,
            "is_dir": info.is_dir(),
            "is_symlink": stat.S_ISLNK(mode),
        })
        if not info.is_dir() and name.endswith(text_suffixes) and info.file_size <= 1024 * 1024:
            try:
                contents[name] = archive.read(info).decode("utf-8")
            except UnicodeDecodeError:
                pass

print(json.dumps({"entries": entries, "contents": contents}))
`;

  const result = spawnSync("python3", ["-c", script, path], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || "Python zipfile validation failed");
  return JSON.parse(result.stdout);
}

export function validateArchiveShape(entries) {
  const errors = [];
  const names = entries.map(({ name }) => name);
  if (new Set(names).size !== names.length)
    errors.push("archive contains duplicate entries");

  for (const entry of entries) {
    const { name } = entry;
    const pathSegments = name.split("/");
    if (
      !name ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.includes("\0") ||
      pathSegments.includes("..") ||
      pathSegments.includes(".")
    )
      errors.push(`${name}: unsafe or non-canonical archive path`);
    if (entry.is_symlink)
      errors.push(`${name}: symbolic links are not allowed in the package`);
  }
  return errors;
}

export function validatePackageInventory(entries, expectedFiles) {
  const errors = [];
  const packagedFiles = new Set();
  for (const { name, is_dir: isDirectory } of entries) {
    if (isDirectory) continue;
    packagedFiles.add(name);
    if (!expectedFiles.has(name))
      errors.push(`${name}: file is not part of the derived runtime inventory`);
  }

  for (const expectedFile of expectedFiles) {
    if (!packagedFiles.has(expectedFile))
      errors.push(`missing runtime entry: ${expectedFile}`);
  }

  return errors;
}

export function validatePackagedJavaScript(contents) {
  const errors = [];
  for (const [name, source] of Object.entries(contents)) {
    if (!name.endsWith(".js")) continue;
    try {
      parse(source, {
        ecmaVersion: "latest",
        sourceType: "module",
        locations: true,
      });
    } catch (error) {
      errors.push(
        `${name}:${error.loc?.line ?? 1}:${(error.loc?.column ?? 0) + 1}: ${error.message}`,
      );
    }
  }
  return errors;
}

export async function checkPackage(inputPath = EXTENSION_PACKAGE) {
  const packagePath = resolve(ROOT, inputPath);
  const displayPath = relative(ROOT, packagePath) || inputPath;
  if (!(await pathExists(packagePath)))
    throw new Error(
      `Package validation failed:\n- package not found: ${displayPath}`,
    );

  let archive;
  try {
    archive = readZip(packagePath);
  } catch (error) {
    throw new Error(
      `Package validation failed:\n- could not inspect package: ${error.message}`,
    );
  }

  const packageJson = JSON.parse(await read("package.json"));
  const entries = archive.entries;
  const errors = [...validateArchiveShape(entries)];
  let metadata = null;

  if (!archive.contents["metadata.json"])
    errors.push("metadata.json is missing");
  else {
    try {
      metadata = JSON.parse(archive.contents["metadata.json"]);
      errors.push(...validateExtensionMetadata(metadata, packageJson));
    } catch (error) {
      errors.push(`metadata.json is invalid: ${error.message}`);
    }
  }

  const sourceFiles = await collect("src", () => true);
  const localeFiles = await collect(
    "assets/locale",
    (path) => extname(path) === ".po",
  );
  const schemaName =
    metadata?.["settings-schema"] ?? "org.gnome.shell.extensions.mediashell";
  const expectedFiles = new Set([
    ...sourceFiles.map((path) => path.slice("src/".length)),
    "org.gnome.shell.extensions.mediashell.gresource",
    `schemas/${schemaName}.gschema.xml`,
    ...localeFiles.map((path) => {
      const locale = path.split("/").at(-1).replace(/\.po$/, "");
      return `locale/${locale}/LC_MESSAGES/${EXTENSION_UUID}.mo`;
    }),
  ]);

  errors.push(...validatePackageInventory(entries, expectedFiles));
  errors.push(...validatePackagedJavaScript(archive.contents));

  fail("Package validation", errors);
  console.log(
    `Package validation passed for ${entries.length} runtime entries: ${displayPath}`,
  );
}
