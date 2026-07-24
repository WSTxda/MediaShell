/**
 * @file development-tool.test.mjs
 * @module tests.development-tool
 *
 * Exercises development validators with deliberately broken inputs.
 *
 * These tests keep failure detection behavior explicit without tying the
 * production build to naming preferences or historical deny lists.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  validateDbusContracts,
  validateSettingContractTables,
} from "../scripts/dev/contracts.mjs";
import {
  validateExternalImport,
  validateMainLoopSourceOwnership,
  validatePrivateShellImport,
  validateRelativeImport,
} from "../scripts/dev/javascript.mjs";
import { validateExtensionMetadata } from "../scripts/dev/metadata.mjs";
import {
  validateArchiveShape,
  validatePackageInventory,
  validatePackagedJavaScript,
} from "../scripts/dev/package.mjs";

test("archive validation rejects unsafe paths, duplicates, and links", () => {
  const errors = validateArchiveShape([
    { name: "../escape.js", is_symlink: false },
    { name: "extension.js", is_symlink: false },
    { name: "extension.js", is_symlink: false },
    { name: "linked.js", is_symlink: true },
  ]);

  assert.ok(errors.some((error) => error.includes("duplicate")));
  assert.ok(errors.some((error) => error.includes("unsafe")));
  assert.ok(errors.some((error) => error.includes("symbolic link")));
});

test("package inventory reports both missing and unexpected files", () => {
  const errors = validatePackageInventory(
    [
      { name: "extension.js", is_dir: false },
      { name: "README.md", is_dir: false },
    ],
    new Set(["extension.js", "metadata.json"]),
  );

  assert.deepEqual(errors, [
    "README.md: file is not part of the derived runtime inventory",
    "missing runtime entry: metadata.json",
  ]);
});

test("packaged JavaScript validation reports a real parser failure", () => {
  const errors = validatePackagedJavaScript({
    "extension.js": "export default class {",
    "metadata.json": "{not JavaScript}",
  });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /^extension\.js:/);
});

test("metadata validation reports contract drift", async () => {
  const metadata = JSON.parse(
    await readFile(new URL("../src/metadata.json", import.meta.url), "utf8"),
  );
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  metadata.uuid = "invalid@example.com";

  const errors = validateExtensionMetadata(metadata, packageJson);

  assert.ok(errors.some((error) => error.startsWith("metadata uuid must be")));
});

test("D-Bus validation reports interfaces missing from introspection", () => {
  const errors = validateDbusContracts({});

  assert.ok(errors.length >= 4);
  assert.ok(
    errors.every((error) =>
      error.startsWith("runtime D-Bus interface is missing:"),
    ),
  );
});

test("settings validation detects schema and runtime table drift", () => {
  const errors = validateSettingContractTables({
    schema: {
      keys: {
        "known-key": {
          type: "b",
          enum: null,
          default: true,
          range: null,
        },
        orphan: {
          type: "u",
          enum: null,
          default: 2,
          range: { min: 1, max: 3 },
        },
      },
    },
    settingsSpec: {
      "known-key": { read: "get_uint", property: "knownProperty" },
      missing: { read: "get_boolean", property: "missing" },
    },
    preferenceBindings: [],
    shortcutKeys: [],
    numericConstraints: {
      orphan: { MIN: 0, MAX: 4, DEFAULT: 1 },
    },
    orderedDefaults: {},
  });

  assert.ok(
    errors.some(
      (error) => error === "code references missing schema key: missing",
    ),
  );
  assert.ok(
    errors.some(
      (error) => error === "schema key has no maintained code owner: orphan",
    ),
  );
  assert.ok(errors.some((error) => error.includes("must be get_boolean")));
  assert.ok(errors.some((error) => error.includes("schema range")));
  assert.ok(errors.some((error) => error.includes("schema default")));
});

test("organization audit detects a misplaced private Shell import", () => {
  const diagnostic = validatePrivateShellImport(
    "src/shell/ui/Example.js",
    "resource:///org/gnome/shell/ui/mpris.js",
  );

  assert.match(diagnostic, /must stay isolated/);
  assert.equal(
    validatePrivateShellImport(
      "src/shell/services/GnomeShellMediaControlsPatch.js",
      "resource:///org/gnome/shell/ui/mpris.js",
    ),
    null,
  );
});

test("module validation catches process-boundary and extension errors", () => {
  assert.deepEqual(validateExternalImport("shared", "gi://Gio"), [
    "shared code imports GNOME runtime API gi://Gio",
  ]);
  assert.deepEqual(
    validateRelativeImport("prefs", "shell", "../shell/Example"),
    [
      "relative module import needs an explicit extension: ../shell/Example",
      "prefs module crosses into shell",
    ],
  );
});

test("runtime validation catches an owned main-loop source without teardown", () => {
  const errors = validateMainLoopSourceOwnership(
    "src/shell/LeakySource.js",
    `
      export default class LeakySource {
        start() {
          this.sourceId = GLib.timeout_add(0, 100, () => 0);
        }
        destroy() {}
      }
    `,
  );

  assert.deepEqual(errors, [
    "src/shell/LeakySource.js:4: GLib source stored in this.sourceId needs a matching GLib.Source.remove(this.sourceId) reachable from teardown",
  ]);
  assert.deepEqual(
    validateMainLoopSourceOwnership(
      "src/shell/OwnedSource.js",
      `
        export default class OwnedSource {
          start() {
            this.sourceId = GLib.idle_add(0, () => 0);
          }
          clearSource() {
            GLib.Source.remove(this.sourceId);
            this.sourceId = null;
          }
          destroy() {
            this.clearSource();
          }
        }
      `,
    ),
    [],
  );

  assert.equal(
    validateMainLoopSourceOwnership(
      "src/shell/DeadCleanup.js",
      `
        export default class DeadCleanup {
          start() {
            this.sourceId = GLib.idle_add(0, () => 0);
          }
          unusedCleanup() {
            GLib.Source.remove(this.sourceId);
          }
          destroy() {}
        }
      `,
    ).length,
    1,
  );
});
