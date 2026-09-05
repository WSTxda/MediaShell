/**
 * @file project.js
 * @module shared.project
 *
 * Defines stable MediaShell identity and project links.
 *
 * Runtime paths, extension metadata checks, and the preferences About dialog
 * consume these values so the UUID, icon identity, and public project URLs do
 * not drift across otherwise unrelated modules.
 */

/** GNOME Shell major versions declared as supported by MediaShell. */
export const SUPPORTED_GNOME_SHELL_VERSIONS = Object.freeze([
  "48",
  "49",
  "50",
  "51",
]);

/** Stable GNOME Shell extension identifier and gettext domain. */
export const EXTENSION_UUID = "mediashell@wstxda.github.com";

/** User-facing extension name recorded in metadata and the About dialog. */
export const EXTENSION_NAME = "MediaShell";

/** Installed themed icon name used by the preferences About dialog. */
export const EXTENSION_ICON_NAME = "mediashell";

/** Public project links displayed by the preferences About dialog. */
export const PROJECT_URLS = Object.freeze({
  REPOSITORY: "https://github.com/WSTxda/MediaShell",
  ISSUES: "https://github.com/WSTxda/MediaShell/issues",
  DONATIONS: "https://buymeacoffee.com/wstxda",
  MEDIA_CONTROLS: "https://github.com/sakithb/media-controls",
});
