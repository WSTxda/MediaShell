/**
 * @file errors.js
 * @module shell.utils.errors
 *
 * Classifies expected Shell-side async errors.
 *
 * Gio.Cancellable aborts are normal during disable, media-app changes, and stale
 * album-art loads. These helpers let services ignore expected cancellation while
 * still logging genuine failures.
 */

import Gio from "gi://Gio";

/**
 * Returns true when the error is a Gio cancellation error.
 *
 * Use this to distinguish intentional async teardown from real failures.
 * Cancelled operations should be silently dropped; genuine errors should be
 * logged at warn or error level by the caller.
 *
 * @param {unknown} error - Error object thrown by a GI async operation.
 * @returns {boolean} True when the error represents Gio.IOErrorEnum.CANCELLED.
 */
export function isCancellationError(error) {
    return Boolean(error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED));
}
