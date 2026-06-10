// Provides scoped, low-noise logging for both the Shell and preferences processes.
const PREFIX = "[MediaShell]";
const ONCE_CACHE_LIMIT = 256;

function write(method, scope, args) {
    const label = scope ? `${PREFIX}[${scope}]` : PREFIX;
    console[method](label, ...args);
}

function rememberOnce(keys, key) {
    const normalized = String(key);
    if (keys.has(normalized)) return false;

    keys.add(normalized);
    if (keys.size > ONCE_CACHE_LIMIT) keys.delete(keys.values().next().value);
    return true;
}

export function createLogger(scope) {
    const debugKeys = new Set();
    const warningKeys = new Set();
    const errorKeys = new Set();

    return Object.freeze({
        debug(...args) {
            write("debug", scope, args);
        },
        debugOnce(key, ...args) {
            if (rememberOnce(debugKeys, key)) write("debug", scope, args);
        },
        warn(...args) {
            write("warn", scope, args);
        },
        warnOnce(key, ...args) {
            if (rememberOnce(warningKeys, key)) write("warn", scope, args);
        },
        error(...args) {
            write("error", scope, args);
        },
        errorOnce(key, ...args) {
            if (rememberOnce(errorKeys, key)) write("error", scope, args);
        },
    });
}
