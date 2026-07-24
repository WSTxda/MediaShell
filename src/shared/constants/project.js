/**
 * @file project.js
 * @module shared.constants.project
 *
 * Defines stable MediaShell identity and project links.
 *
 * Runtime paths, extension metadata checks, and the preferences About dialog
 * consume these values so the UUID, icon identity, and public project URLs do
 * not drift across otherwise unrelated modules.
 */

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
  MEDIA_CONTROLS_CONTRIBUTORS:
    "https://github.com/sakithb/media-controls/graphs/contributors?all=1",
});
