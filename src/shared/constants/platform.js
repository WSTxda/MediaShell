// Defines the supported GNOME platform baseline shared by runtime guards and validation.
export const SUPPORTED_GNOME_SHELL_VERSIONS = Object.freeze(["47", "48", "49", "50"]);

export const MINIMUM_LIBADWAITA_VERSION = Object.freeze({
    major: 1,
    minor: 6,
});

export function isVersionAtLeast(major, minor, minimum = MINIMUM_LIBADWAITA_VERSION) {
    return major > minimum.major || (major === minimum.major && minor >= minimum.minor);
}
