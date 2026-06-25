/**
 * @file errors.js
 * @module shell.utils.errors
 *
 * Shell-side error classification utilities.
 *
 * Provides predicates for distinguishing expected cancellation errors from
 * genuine failures. Cancellation errors arise whenever an async operation is
 * aborted via Gio.Cancellable and must be silently discarded rather than
 * logged as warnings.
 */
import Gio from "gi://Gio";

/**
 * Returns true when the error is a Gio cancellation error.
 *
 * Use this to distinguish intentional async teardown from real failures.
 * Cancelled operations should be silently dropped; genuine errors should
 * be logged at warn or error level.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isCancellationError(error) {
    return Boolean(error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED));
}
