/**
 * @file clientPolicy.js
 * @module shell.mpris.clientPolicy
 *
 * Defines MediaShell policy around an MPRIS client's lifecycle.
 *
 * The constants here are intentionally not protocol constants: they bound proxy
 * initialization, D-Bus calls, browser metadata stabilization, and owner handoff.
 * Owner snapshots prevent late asynchronous replies from a replaced process from
 * mutating the state of the new owner of the same well-known bus name.
 */

import { PlaybackStatus, normalizePlaybackStatus } from "./protocol.js";

export const MPRIS_INIT_TIMEOUT_MS = 5000;
export const MPRIS_INIT_POLL_INTERVAL_MS = 750;
export const DBUS_CALL_TIMEOUT_MS = 1000;
export const DBUS_LIST_NAMES_TIMEOUT_MS = 2000;
export const MPRIS_EMPTY_STOPPED_GRACE_MS = 5000;
export const MPRIS_OWNER_HANDOFF_GRACE_MS = 5000;

/** MediaShell-owned notifications emitted by MprisPlayer. */
export const MprisPlayerStateProperties = Object.freeze({
  IS_PINNED: "IsPinned",
  IS_INVALID: "IsInvalid",
});

/** Internal validity state for one MPRIS endpoint. */
export const MprisPlayerValidity = Object.freeze({
  INVALID: "invalid",
  VALID: "valid",
  EMPTY_STOPPED_GRACE: "empty-stopped-grace",
});

function normalizeNameOwner(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Resolves a well-known MPRIS name's current unique-owner transition. */
export function resolveMprisOwnerTransition(previousOwner, currentOwner) {
  const previous = normalizeNameOwner(previousOwner);
  const current = normalizeNameOwner(currentOwner);
  return Object.freeze({
    owner: current,
    hasOwner: current !== null,
    changed: current !== null && current !== previous,
  });
}

/** Checks whether an async result still belongs to its captured unique owner. */
export function matchesMprisOwnerSnapshot(
  snapshotOwner,
  snapshotGeneration,
  currentOwner,
  currentGeneration,
) {
  const normalizedSnapshotOwner = normalizeNameOwner(snapshotOwner);
  const normalizedCurrentOwner = normalizeNameOwner(currentOwner);
  return (
    normalizedSnapshotOwner !== null &&
    normalizedSnapshotOwner === normalizedCurrentOwner &&
    snapshotGeneration === currentGeneration
  );
}

/**
 * Resolves whether an endpoint is usable without discarding transient browser state.
 *
 * After a real track has been presented, empty Metadata + Stopped enters a bounded
 * grace period. This preserves adjacent feed/Shorts transitions without allowing
 * an ended session to remain visible indefinitely.
 */
export function resolveMprisPlayerValidity({
  hasIdentity,
  hasTrackMetadata,
  hasPresentedTrackMetadata,
  playbackStatus,
}) {
  if (!hasIdentity) return MprisPlayerValidity.INVALID;
  if (hasTrackMetadata) return MprisPlayerValidity.VALID;
  if (normalizePlaybackStatus(playbackStatus) !== PlaybackStatus.STOPPED)
    return MprisPlayerValidity.VALID;
  return hasPresentedTrackMetadata
    ? MprisPlayerValidity.EMPTY_STOPPED_GRACE
    : MprisPlayerValidity.INVALID;
}
