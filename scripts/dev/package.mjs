/**
 * @file package.mjs
 * @module scripts.dev.package
 *
 * Validates the generated GNOME Shell extension archive and runtime-only shape.
 *
 * Python's zipfile parser supplies bounded entry metadata, SHA-256 digests,
 * UTF-8 runtime sources, and gettext binary validation. Acorn resolves every
 * static packaged import, while native compilers derive the exact expected
 * resource and catalog bytes from the current checkout.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, posix, relative, resolve } from "node:path";

import { EXTENSION_UUID } from "../../src/shared/project.js";
import { ROOT, collect, fail, pathExists, read, rootPath } from "./files.mjs";
import {
  collectModuleSpecifiers,
  findMissingImportedNames,
  parseJavaScriptModule,
} from "./javascript.mjs";
import { validateExtensionMetadata } from "./metadata.mjs";

export const EXTENSION_PACKAGE = `dist/builds/${EXTENSION_UUID}.shell-extension.zip`;

function readZip(path) {
  const script = String.raw`
import gettext
import hashlib
import io
import json
import stat
import struct
import sys
import zipfile

MAX_ENTRY_COUNT = 4096
MAX_ENTRY_SIZE = 32 * 1024 * 1024
MAX_TOTAL_SIZE = 128 * 1024 * 1024
MAX_TEXT_SIZE = 8 * 1024 * 1024

entries = []
contents = {}
text_errors = []
binary_errors = []
text_suffixes = (".js", ".mjs", ".json")

with zipfile.ZipFile(sys.argv[1]) as archive:
    infos = archive.infolist()
    if len(infos) > MAX_ENTRY_COUNT:
        raise RuntimeError(f"archive has more than {MAX_ENTRY_COUNT} entries")
    total_size = sum(info.file_size for info in infos if not info.is_dir())
    if total_size > MAX_TOTAL_SIZE:
        raise RuntimeError(f"archive expands beyond {MAX_TOTAL_SIZE} bytes")
    oversized = next(
        (info for info in infos if not info.is_dir() and info.file_size > MAX_ENTRY_SIZE),
        None,
    )
    if oversized:
        raise RuntimeError(
            f"{oversized.filename}: entry expands beyond {MAX_ENTRY_SIZE} bytes"
        )

    for info in infos:
        name = info.filename
        mode = info.external_attr >> 16
        entry = {
            "name": name,
            "size": info.file_size,
            "compressed_size": info.compress_size,
            "is_dir": info.is_dir(),
            "is_symlink": stat.S_ISLNK(mode),
            "is_special": stat.S_IFMT(mode) not in (
                0,
                stat.S_IFREG,
                stat.S_IFDIR,
                stat.S_IFLNK,
            ),
            "sha256": None,
        }
        entries.append(entry)
        if info.is_dir():
            continue

        data = archive.read(info)
        entry["sha256"] = hashlib.sha256(data).hexdigest()
        if name.endswith(text_suffixes):
            if info.file_size > MAX_TEXT_SIZE:
                text_errors.append(
                    f"{name}: text entry exceeds the {MAX_TEXT_SIZE}-byte parser limit"
                )
                continue
            try:
                contents[name] = data.decode("utf-8")
            except UnicodeDecodeError:
                text_errors.append(f"{name}: text entry is not valid UTF-8")
        if name.endswith(".mo"):
            if not data:
                binary_errors.append(f"{name}: compiled gettext catalog is empty")
                continue
            try:
                gettext.GNUTranslations(io.BytesIO(data))
            except (EOFError, OSError, struct.error) as error:
                binary_errors.append(
                    f"{name}: compiled gettext catalog is invalid: {error}"
                )

print(json.dumps({
    "entries": entries,
    "contents": contents,
    "text_errors": text_errors,
    "binary_errors": binary_errors,
}))
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
    const pathWithoutTrailingSlash =
      entry.is_dir && name.endsWith("/") ? name.slice(0, -1) : name;
    const pathSegments = pathWithoutTrailingSlash.split("/");
    const firstSegment = pathSegments[0] ?? "";
    const firstCharacter = firstSegment.charCodeAt(0);
    const hasWindowsDrivePrefix =
      firstSegment.length >= 2 &&
      firstSegment[1] === ":" &&
      ((firstCharacter >= 65 && firstCharacter <= 90) ||
        (firstCharacter >= 97 && firstCharacter <= 122));
    const hasControlCharacter = [...name].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
    const isUnsafe =
      !name ||
      name.startsWith("/") ||
      name.includes("\\") ||
      hasControlCharacter ||
      hasWindowsDrivePrefix ||
      pathSegments.includes("") ||
      pathSegments.includes("..") ||
      pathSegments.includes(".") ||
      posix.normalize(pathWithoutTrailingSlash) !== pathWithoutTrailingSlash ||
      Boolean(entry.is_dir) !== name.endsWith("/");
    if (isUnsafe) errors.push(`${name}: unsafe or non-canonical archive path`);
    if (entry.is_symlink)
      errors.push(`${name}: symbolic links are not allowed in the package`);
    if (entry.is_special)
      errors.push(`${name}: special filesystem entries are not allowed`);
  }
  return errors;
}

export function validatePackageInventory(entries, expectedFiles) {
  const errors = [];
  const packagedFiles = new Set();
  const expectedDirectories = new Set();
  for (const expectedFile of expectedFiles) {
    const segments = expectedFile.split("/");
    for (let length = 1; length < segments.length; length++)
      expectedDirectories.add(`${segments.slice(0, length).join("/")}/`);
  }

  for (const { name, is_dir: isDirectory } of entries) {
    if (isDirectory) {
      if (!expectedDirectories.has(name))
        errors.push(`${name}: directory is not part of the runtime inventory`);
      continue;
    }
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

/** Compares every packaged runtime file with content derived from this checkout. */
export function validatePackageContents(entries, expectedHashes) {
  const errors = [];
  const packagedHashes = new Map(
    entries
      .filter(({ is_dir: isDirectory }) => !isDirectory)
      .map(({ name, sha256 }) => [name, sha256]),
  );
  for (const [name, expectedHash] of expectedHashes) {
    const packagedHash = packagedHashes.get(name);
    if (packagedHashes.has(name) && packagedHash !== expectedHash)
      errors.push(
        `${name}: packaged bytes differ from the current build input`,
      );
  }
  return errors;
}

export function validatePackagedJavaScript(
  contents,
  packagedFiles = new Set(Object.keys(contents)),
) {
  const errors = [];
  const records = new Map();
  for (const [name, source] of Object.entries(contents)) {
    if (!name.endsWith(".js") && !name.endsWith(".mjs")) continue;
    try {
      records.set(name, parseJavaScriptModule(name, source));
    } catch (error) {
      errors.push(
        `${name}:${error.loc?.line ?? 1}:${(error.loc?.column ?? 0) + 1}: ${error.message}`,
      );
    }
  }

  for (const record of records.values()) {
    for (const item of collectModuleSpecifiers(record)) {
      if (!item.value.startsWith(".")) continue;
      const target = posix.normalize(
        posix.join(posix.dirname(record.file), item.value),
      );
      if (
        target === ".." ||
        target.startsWith("../") ||
        posix.isAbsolute(target)
      ) {
        errors.push(
          `${record.file}:${item.line}: relative import escapes the package: ${item.value}`,
        );
      } else if (!packagedFiles.has(target)) {
        errors.push(
          `${record.file}:${item.line}: packaged import target is missing: ${target}`,
        );
      } else if (item.kind === "import" && records.has(target)) {
        for (const importedName of findMissingImportedNames(
          item.node,
          records.get(target),
        ))
          errors.push(
            `${record.file}:${item.line}: ${target} does not export ${importedName}`,
          );
      }
    }
  }
  return errors;
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runNativeCompiler(label, command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error)
    throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(
      `${label} exited with status ${result.status ?? "unknown"}: ${result.stderr.trim()}`,
    );
}

function localeNameFromSource(localeFile) {
  const fileName = localeFile.split("/").at(-1);
  return fileName.slice(0, -extname(fileName).length);
}

function deriveExpectedPackageNames(sourceFiles, localeFiles, schemaName) {
  return new Set([
    ...sourceFiles.map((path) => path.slice("src/".length)),
    "org.gnome.shell.extensions.mediashell.gresource",
    `schemas/${schemaName}.gschema.xml`,
    ...localeFiles.map((localeFile) => {
      const locale = localeNameFromSource(localeFile);
      return `locale/${locale}/LC_MESSAGES/${EXTENSION_UUID}.mo`;
    }),
  ]);
}

async function deriveExpectedPackageHashes(
  sourceFiles,
  localeFiles,
  schemaName,
) {
  const expectedHashes = new Map();
  for (const sourceFile of sourceFiles) {
    const packageName = sourceFile.slice("src/".length);
    expectedHashes.set(
      packageName,
      hashBytes(await readFile(rootPath(sourceFile))),
    );
  }

  const schemaSource =
    "assets/org.gnome.shell.extensions.mediashell.gschema.xml";
  expectedHashes.set(
    `schemas/${schemaName}.gschema.xml`,
    hashBytes(await readFile(rootPath(schemaSource))),
  );

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "mediashell-package-content-"),
  );
  try {
    const resourceOutput = join(
      temporaryDirectory,
      "org.gnome.shell.extensions.mediashell.gresource",
    );
    runNativeCompiler("glib-compile-resources", "glib-compile-resources", [
      rootPath("assets/org.gnome.shell.extensions.mediashell.gresource.xml"),
      `--target=${resourceOutput}`,
      `--sourcedir=${rootPath("assets")}`,
    ]);
    expectedHashes.set(
      "org.gnome.shell.extensions.mediashell.gresource",
      hashBytes(await readFile(resourceOutput)),
    );

    for (const localeFile of localeFiles) {
      const locale = localeNameFromSource(localeFile);
      const catalogOutput = join(temporaryDirectory, `${locale}.mo`);
      runNativeCompiler("msgfmt", "msgfmt", [
        "--check",
        "--check-header",
        "--check-format",
        `--output-file=${catalogOutput}`,
        rootPath(localeFile),
      ]);
      expectedHashes.set(
        `locale/${locale}/LC_MESSAGES/${EXTENSION_UUID}.mo`,
        hashBytes(await readFile(catalogOutput)),
      );
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  return expectedHashes;
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
  const errors = [
    ...validateArchiveShape(entries),
    ...archive.text_errors,
    ...archive.binary_errors,
  ];
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
  const sourceMetadata = JSON.parse(await read("src/metadata.json"));
  const expectedFiles = deriveExpectedPackageNames(
    sourceFiles,
    localeFiles,
    sourceMetadata["settings-schema"],
  );
  const packagedFiles = new Set(
    entries
      .filter(({ is_dir: isDirectory }) => !isDirectory)
      .map(({ name }) => name),
  );
  errors.push(...validatePackageInventory(entries, expectedFiles));
  errors.push(...validatePackagedJavaScript(archive.contents, packagedFiles));
  fail("Package validation", errors);

  let expectedHashes;
  try {
    expectedHashes = await deriveExpectedPackageHashes(
      sourceFiles,
      localeFiles,
      sourceMetadata["settings-schema"],
    );
  } catch (error) {
    throw new Error(
      `Package validation failed:\n- could not derive expected runtime content: ${error.message}`,
    );
  }
  errors.push(...validatePackageContents(entries, expectedHashes));

  fail("Package validation", errors);
  console.log(
    `Package validation passed for ${entries.length} runtime entries: ${displayPath}`,
  );
}
