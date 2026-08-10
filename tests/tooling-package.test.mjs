/**
 * @file tooling-package.test.mjs
 * @module tests.toolingPackage
 *
 * Exercises essential source, declarative, and package validators.
 * Corruption fixtures keep failures tied to build and archive integrity.
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
  validatePrivateShellImport,
  validateRelativeImport,
} from "../scripts/dev/javascript.mjs";
import { validateExtensionMetadata } from "../scripts/dev/metadata.mjs";
import {
  validateArchiveShape,
  validatePackageInventory,
  validatePackagedJavaScript,
} from "../scripts/dev/package.mjs";
import { runCases } from "./helpers.mjs";

test("essential validators reject corrupted source, contracts, and ZIP contents", async () => {
  await runCases([
    [
      "archive shape",
      () => {
        const errors = validateArchiveShape([
          { name: "../escape.js", is_symlink: false },
          { name: "extension.js", is_symlink: false },
          { name: "extension.js", is_symlink: false },
          { name: "linked.js", is_symlink: true },
        ]);
        assert.ok(errors.some((error) => error.includes("unsafe")));
        assert.ok(errors.some((error) => error.includes("duplicate")));
        assert.ok(errors.some((error) => error.includes("symbolic link")));
      },
    ],
    [
      "package inventory",
      () => {
        assert.deepEqual(
          validatePackageInventory(
            [
              { name: "extension.js", is_dir: false },
              { name: "README.md", is_dir: false },
            ],
            new Set(["extension.js", "metadata.json"]),
          ),
          [
            "README.md: file is not part of the derived runtime inventory",
            "missing runtime entry: metadata.json",
          ],
        );
        assert.equal(
          validatePackagedJavaScript({
            "extension.js": "export default class {",
          }).length,
          1,
        );
      },
    ],
    [
      "metadata and D-Bus",
      async () => {
        const metadata = JSON.parse(
          await readFile(
            new URL("../src/metadata.json", import.meta.url),
            "utf8",
          ),
        );
        const packageJson = JSON.parse(
          await readFile(new URL("../package.json", import.meta.url), "utf8"),
        );
        metadata.uuid = "invalid@example.com";
        assert.ok(
          validateExtensionMetadata(metadata, packageJson).some((error) =>
            error.startsWith("metadata uuid must be"),
          ),
        );
        assert.ok(validateDbusContracts({}).length >= 4);
      },
    ],
    [
      "settings",
      () => {
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
          numericConstraints: { orphan: { MIN: 0, MAX: 4, DEFAULT: 1 } },
          orderedDefaults: {},
        });
        assert.ok(errors.some((error) => error.includes("missing schema key")));
        assert.ok(
          errors.some((error) => error.includes("no maintained code owner")),
        );
        assert.ok(
          errors.some((error) => error.includes("must be get_boolean")),
        );
      },
    ],
    [
      "process boundaries",
      () => {
        assert.deepEqual(validateExternalImport("shared", "gi://Gio"), [
          "shared code imports GNOME runtime API gi://Gio",
        ]);
        assert.deepEqual(validateExternalImport("shell", "gi://Graphene"), []);
        assert.deepEqual(
          validateRelativeImport("prefs", "shell", "../shell/Example"),
          [
            "relative module import needs an explicit extension: ../shell/Example",
            "prefs module crosses into shell",
          ],
        );
        assert.match(
          validatePrivateShellImport(
            "src/shell/ui/Example.js",
            "resource:///org/gnome/shell/ui/mpris.js",
          ),
          /must stay isolated/,
        );
      },
    ],
  ]);
});
