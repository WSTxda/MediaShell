/**
 * @file build.mjs
 * @module scripts.dev.build
 *
 * Builds extension packages from one clean staging tree per profile.
 *
 * Profiles never rewrite extension identity, metadata, version, or artwork.
 * Their only semantic difference is which validation pipeline surrounds this
 * packaging primitive. Every successful build replaces one canonical ZIP.
 */

import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { EXTENSION_UUID } from "../../src/shared/project.js";
import { ROOT, rootPath, runCommand } from "./files.mjs";

export const PACKAGE_FILENAME = `${EXTENSION_UUID}.shell-extension.zip`;
export const BUILD_PROFILES = Object.freeze(["debug", "force", "release"]);

export const PACKAGE_PATH = `dist/builds/${PACKAGE_FILENAME}`;

async function cleanLegacyBuildOutputs() {
  for (const directory of ["dist/debug", "dist/force", "dist/release"])
    await rm(rootPath(directory), { recursive: true, force: true });

  for (const filename of [
    `${EXTENSION_UUID}.debug.shell-extension.zip`,
    `${EXTENSION_UUID}.force.shell-extension.zip`,
  ])
    await rm(rootPath(`dist/builds/${filename}`), { force: true });
}

async function copyRuntimeSource(stageDirectory) {
  for (const entry of await readdir(rootPath("src"), { withFileTypes: true })) {
    const source = rootPath(`src/${entry.name}`);
    const destination = join(stageDirectory, entry.name);
    await cp(source, destination, {
      recursive: entry.isDirectory(),
      force: true,
    });
  }
}

export async function buildExtension(
  profile,
  { outputPath = rootPath(PACKAGE_PATH) } = {},
) {
  if (!BUILD_PROFILES.includes(profile))
    throw new Error(`Unknown build profile: ${profile}`);

  await cleanLegacyBuildOutputs();
  const stageDirectory = rootPath(`dist/.stage/${profile}`);
  const packDirectory = rootPath(`dist/.pack/${profile}`);
  await rm(stageDirectory, { recursive: true, force: true });
  await rm(packDirectory, { recursive: true, force: true });
  await mkdir(stageDirectory, { recursive: true });
  await mkdir(packDirectory, { recursive: true });

  try {
    await copyRuntimeSource(stageDirectory);

    const resourceOutput = join(
      stageDirectory,
      "org.gnome.shell.extensions.mediashell.gresource",
    );
    runCommand(
      "compile GResource",
      "glib-compile-resources",
      [
        rootPath("assets/org.gnome.shell.extensions.mediashell.gresource.xml"),
        `--target=${resourceOutput}`,
        `--sourcedir=${rootPath("assets")}`,
      ],
      { cwd: ROOT },
    );

    runCommand(
      `pack ${profile} extension`,
      "gnome-extensions",
      [
        "pack",
        "--force",
        "--out-dir",
        packDirectory,
        `--schema=${rootPath("assets/org.gnome.shell.extensions.mediashell.gschema.xml")}`,
        `--podir=${rootPath("assets/locale")}`,
        "--extra-source=shell",
        "--extra-source=prefs",
        "--extra-source=shared",
        "--extra-source=icons",
        "--extra-source=org.gnome.shell.extensions.mediashell.gresource",
        ".",
      ],
      { cwd: stageDirectory },
    );

    const packedPath = join(packDirectory, PACKAGE_FILENAME);
    await mkdir(dirname(outputPath), { recursive: true });
    if (outputPath === rootPath(PACKAGE_PATH))
      await rm(`${outputPath}.sha256`, { force: true });
    await rm(outputPath, { force: true });
    await rename(packedPath, outputPath);
    console.log(
      `Built ${profile} package: ${relative(ROOT, outputPath).replaceAll("\\", "/")}`,
    );
    return outputPath;
  } finally {
    await rm(stageDirectory, { recursive: true, force: true });
    await rm(packDirectory, { recursive: true, force: true });
  }
}

export async function writePackageDigest(packagePath = rootPath(PACKAGE_PATH)) {
  const digest = createHash("sha256")
    .update(await readFile(packagePath))
    .digest("hex");
  await writeFile(
    `${packagePath}.sha256`,
    `${digest}  ${PACKAGE_FILENAME}\n`,
    "utf8",
  );
  return digest;
}

export async function cleanReleaseWork() {
  await rm(rootPath("dist/.release-tmp"), { recursive: true, force: true });
  await rm(rootPath("dist/.release-ready"), { recursive: true, force: true });
}
