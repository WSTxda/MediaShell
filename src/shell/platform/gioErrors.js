/**
 * @file gioErrors.js
 * @module shell.platform.gioErrors
 *
 * Classifies expected Shell-side async errors.
 *
 * Gio.Cancellable aborts are normal during disable, player changes, and stale
 * artwork loads. These helpers let async owners ignore expected cancellation while
 * still logging genuine failures.
 */

import Gio from "gi://Gio";

/**
 * Returns true when the error is a Gio cancellation error.
 *
 * Use this to distinguish intentional async teardown from real failures.
 * Canceled operations should be silently dropped; genuine errors should be
 * logged at warn or error level by the caller.
 *
 * @param {unknown} error - Error object thrown by a GI async operation.
 * @returns {boolean} True when the error represents Gio.IOErrorEnum.CANCELLED.
 */
export function isCancellationError(error) {
  return Boolean(error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED));
}

/**
 * Returns the remote D-Bus error name without exposing a raw GError.
 *
 * @param {unknown} error - Error returned by a Gio D-Bus operation.
 * @returns {string|null} Remote D-Bus error name when present.
 */
function readRemoteDBusErrorName(error) {
  try {
    if (!Gio.DBusError.is_remote_error(error)) return null;
    return Gio.DBusError.get_remote_error(error) ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns a stable diagnostic error name for an operation result.
 *
 * @param {unknown} error - Error returned by a delegate or Gio call.
 * @returns {string|null} Remote D-Bus name, local error name, or null.
 */
export function resolveOperationErrorName(error) {
  const remoteErrorName = readRemoteDBusErrorName(error);
  if (remoteErrorName) return remoteErrorName;
  return typeof error?.name === "string" && error.name.length > 0
    ? error.name
    : null;
}
