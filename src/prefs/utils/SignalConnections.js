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
// Used when a prefs controller owns signals from several source objects and needs deterministic disconnect order
export function connectOwnedSignal(ownedSignalConnections, object, signal, callback) {
    const signalId = object.connect(signal, callback);
    ownedSignalConnections.push({ object, signalId });
}

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
