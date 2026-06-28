/**
 * @file log.js
 * @module shared.utils.log
 *
 * Creates scoped loggers with once-only deduplication for noisy runtime paths.
 *
 * Each logger prefixes messages with a class or module scope and bounds its
 * per-level once cache using LOG_ONCE_CACHE_LIMIT. Shell and preferences modules
 * use this helper instead of direct console calls so logs stay consistent.
 */

import { LOG_ONCE_CACHE_LIMIT } from "../constants/limits.js";

const PREFIX = "[MediaShell]";

function write(method, scope, args) {
    const label = scope ? `${PREFIX}[${scope}]` : PREFIX;
    console[method](label, ...args);
}

function rememberOnce(keys, key) {
    const normalized = String(key);
    if (keys.has(normalized)) return false;

    keys.add(normalized);
    if (keys.size > LOG_ONCE_CACHE_LIMIT) keys.delete(keys.values().next().value);
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
