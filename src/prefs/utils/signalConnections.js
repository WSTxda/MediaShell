/**
 * @file signalConnections.js
 * @module prefs.utils.signalConnections
 *
 * Tracks explicit signal ownership for preferences controllers.
 *
 * Controllers use this helper when they connect several source objects and need
 * teardown order to stay visible in destroy(). It replaces duplicated
 * connect/disconnect arrays while keeping ownership more explicit than broad
 * object-lifetime signal helpers.
 */

/**
 * Connects a signal and records its source object with the handler ID.
 *
 * Preferences controllers use this for long-lived widgets and helpers whose
 * lifetime is owned by a page controller rather than GtkBuilder alone. The stored
 * shape is intentionally explicit so teardown code remains easy to inspect.
 *
 * @param {Array<{object: object, signalId: number}>} ownedSignalConnections - Mutable ownership list.
 * @param {object} object - Signal source object.
 * @param {string} signal - Signal name to connect.
 * @param {Function} callback - Signal callback.
 */
export function connectOwnedSignal(
  ownedSignalConnections,
  object,
  signal,
  callback,
) {
  const signalId = object.connect(signal, callback);
  ownedSignalConnections.push({ object, signalId });
}

/**
 * Disconnects every signal stored by connectOwnedSignal().
 *
 * @param {Array<{object: object, signalId: number}>} ownedSignalConnections - Mutable ownership list.
 */
export function disconnectOwnedSignals(ownedSignalConnections) {
  for (const { object, signalId } of ownedSignalConnections)
    object.disconnect(signalId);
  ownedSignalConnections.length = 0;
}
