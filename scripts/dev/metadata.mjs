/**
 * @file metadata.mjs
 * @module scripts.dev.metadata
 *
 * Validates extension metadata against shared project and platform contracts.
 *
 * Source and packaged metadata use this same validator so release checks cannot
 * drift from repository checks when identity, version, or platform policy changes.
 */

import {
  EXTENSION_NAME,
  EXTENSION_UUID,
  PROJECT_URLS,
} from "../../src/shared/constants/project.js";
import { SUPPORTED_GNOME_SHELL_VERSIONS } from "../../src/shared/constants/platform.js";

/**
 * Returns every mismatch in a parsed extension metadata object.
 *
 * @param {object} metadata - Parsed metadata.json object.
 * @param {object} packageJson - Parsed repository package.json object.
 * @returns {string[]} Contract errors.
 */
export function validateExtensionMetadata(metadata, packageJson) {
  const errors = [];
  const requiredFields = [
    "uuid",
    "name",
    "description",
    "shell-version",
    "settings-schema",
    "gettext-domain",
    "version-name",
    "url",
  ];
  for (const field of requiredFields) {
    if (!(field in metadata)) errors.push(`metadata.json is missing ${field}`);
  }

  if (metadata.uuid !== EXTENSION_UUID)
    errors.push(`metadata uuid must be ${EXTENSION_UUID}`);
  if (metadata.name !== EXTENSION_NAME)
    errors.push(`metadata name must be ${EXTENSION_NAME}`);
  if (metadata["gettext-domain"] !== EXTENSION_UUID)
    errors.push("metadata gettext-domain differs from the extension UUID");
  if (metadata["version-name"] !== packageJson.version)
    errors.push("metadata version-name differs from package.json version");
  if (metadata.url !== PROJECT_URLS.REPOSITORY)
    errors.push("metadata project URL differs from shared project constants");
  if (
    JSON.stringify(metadata["shell-version"]) !==
    JSON.stringify(SUPPORTED_GNOME_SHELL_VERSIONS)
  )
    errors.push(
      "metadata shell-version differs from shared platform constants",
    );
  return errors;
}
