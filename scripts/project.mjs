// Defines shared repository constants used by MediaShell validation and release scripts.

import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const EXTENSION_UUID = "mediashell@wstxda.github.com";
export const EXTENSION_PACKAGE = `dist/builds/${EXTENSION_UUID}.shell-extension.zip`;
export const IGNORED_DIRECTORIES = new Set([".git", "dist", "node_modules", "__pycache__"]);

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

export const FORBIDDEN_API_PATTERNS = [
    {
        pattern: /\bClutter\.(?:ClickAction|TapAction)\b/,
        description: "removed Clutter action class; use ClickGesture or an isolated event fallback",
    },
    {
        pattern: /\bvertical\s*:/,
        description: "deprecated St vertical property; use orientation with Clutter.Orientation",
    },
    {
        pattern: /\bExtensionUtils\b|imports\.(?:ui|misc|gi)\b/,
        description: "legacy extension imports are not allowed",
    },
    {
        pattern: /\brun_dispose\s*\(/,
        description: "manual run_dispose usage",
    },
    {
        pattern: /gschemas\.compiled/,
        description: "compiled GSettings schemas must not be shipped or referenced",
    },
];
