/**
 * @file mprisOperationResult.js
 * @module shared.utils.mprisOperationResult
 *
 * Defines the small immutable result contract returned by MPRIS operations.
 *
 * The contract is GI-free so the Shell boundary and Node-based tests can share
 * the same vocabulary without importing Gio or leaking raw GError instances.
 */

export const MprisOperationStatuses = Object.freeze({
  SUCCESS: "success",
  UNSUPPORTED: "unsupported",
  CANCELLED: "cancelled",
  FAILED: "failed",
});

export const MprisOperationReasons = Object.freeze({
  COMPLETED: "completed",
  ALREADY_CURRENT: "already-current",
  CAPABILITY: "capability",
  INVALID_ARGUMENT: "invalid-argument",
  NO_CHANGE: "no-change",
  MISSING_TARGET: "missing-target",
  MISSING_METHOD: "missing-method",
  UNKNOWN_ACTION: "unknown-action",
  DESTROYED: "destroyed",
  CANCELLED: "cancelled",
  MISSING_PROXY: "missing-proxy",
  NO_OWNER: "no-owner",
  OWNER_CHANGED: "owner-changed",
  DBUS_ERROR: "dbus-error",
  DELEGATE_ERROR: "delegate-error",
});

const VALID_STATUSES = new Set(Object.values(MprisOperationStatuses));

/**
 * Creates one immutable operation result.
 *
 * @param {string} status - One value from MprisOperationStatuses.
 * @param {string} reason - Stable machine-readable reason.
 * @param {string|null} [errorName] - Optional remote/local error name.
 * @returns {{status: string, reason: string, errorName: string|null}}
 */
export function createMprisOperationResult(status, reason, errorName = null) {
  if (!VALID_STATUSES.has(status))
    throw new TypeError(`Unknown MPRIS operation status: ${status}`);

  return Object.freeze({
    status,
    reason: String(reason || status),
    errorName:
      typeof errorName === "string" && errorName.length > 0 ? errorName : null,
  });
}

export function mprisOperationSucceeded(
  reason = MprisOperationReasons.COMPLETED,
) {
  return createMprisOperationResult(MprisOperationStatuses.SUCCESS, reason);
}

export function mprisOperationUnsupported(
  reason = MprisOperationReasons.CAPABILITY,
) {
  return createMprisOperationResult(MprisOperationStatuses.UNSUPPORTED, reason);
}

export function mprisOperationCancelled(
  reason = MprisOperationReasons.CANCELLED,
) {
  return createMprisOperationResult(MprisOperationStatuses.CANCELLED, reason);
}

export function mprisOperationFailed(
  reason = MprisOperationReasons.DBUS_ERROR,
  errorName = null,
) {
  return createMprisOperationResult(
    MprisOperationStatuses.FAILED,
    reason,
    errorName,
  );
}

export function isMprisOperationResult(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    VALID_STATUSES.has(value.status) &&
    typeof value.reason === "string" &&
    (value.errorName === null || typeof value.errorName === "string")
  );
}

/**
 * Normalizes legacy/no-value delegates as successful completed operations.
 *
 * MprisMediaApp returns a full result, while this fallback keeps executor test
 * doubles and compatible third-party delegates from reintroducing undefined.
 */
export function normalizeMprisOperationResult(value) {
  return isMprisOperationResult(value) ? value : mprisOperationSucceeded();
}
