/**
 * @file owner.js
 * @module shell.mpris.owner
 *
 * Resolves stable owner transitions for one well-known MPRIS bus name.
 *
 * Gio proxies follow the well-known name, while each operation must snapshot
 * the current unique owner so late replies from a replaced process are ignored.
 */

function normalizeNameOwner(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Returns the normalized owner transition for one MPRIS endpoint. */
export function resolveMprisOwnerTransition(previousOwner, currentOwner) {
  const previous = normalizeNameOwner(previousOwner);
  const current = normalizeNameOwner(currentOwner);
  return Object.freeze({
    owner: current,
    hasOwner: current !== null,
    changed: current !== null && current !== previous,
  });
}

/** Checks whether an asynchronous reply still belongs to its owner snapshot. */
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
