/**
 * @file styleClasses.js
 * @module shell.utils.styleClasses
 *
 * Joins optional Shell CSS class names into one actor style string.
 *
 * UI renderers use this helper for conditional class composition while class
 * identity stays in the owning constants module. Empty values are discarded so
 * callers do not need local filtering boilerplate.
 */

/** Returns a space-separated CSS class string without empty entries. */
export function styleClassNames(...classNames) {
  return classNames.filter(Boolean).join(" ");
}
