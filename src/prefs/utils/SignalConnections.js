/**
 * @file SignalConnections.js
 * @module prefs.utils.SignalConnections
 *
 * Tracks explicit signal ownership for preferences controllers.
 *
 * Controllers use this helper when they connect several source objects and need
 * teardown order to stay visible in destroy(). It replaces duplicated
 * connect/disconnect arrays while keeping ownership more explicit than a broad
 * connectObject() migration.
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
export function connectOwnedSignal(ownedSignalConnections, object, signal, callback) {
    const signalId = object.connect(signal, callback);
    ownedSignalConnections.push({ object, signalId });
}

/**
 * Disconnects every signal stored by connectOwnedSignal().
 *
 * Disconnect failures are passed to the caller because disposed GTK objects can
 * throw during teardown; page controllers decide whether that should be logged or
 * ignored in their context.
 *
 * @param {Array<{object: object, signalId: number}>} ownedSignalConnections - Mutable ownership list.
 * @param {(error: unknown) => void} logDisconnectedSignal - Failure logger.
 */
export function disconnectOwnedSignals(ownedSignalConnections, logDisconnectedSignal) {
    for (const { object, signalId } of ownedSignalConnections) {
        try {
            object.disconnect(signalId);
        } catch (error) {
            logDisconnectedSignal(error);
        }
    }
    ownedSignalConnections.length = 0;
}
