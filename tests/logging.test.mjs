// Tests for: src/shared/utils/log.js
// Covers: scoped logger output, once-only cache isolation per level, and LRU bounds
import assert from "node:assert/strict";
import test from "node:test";

import { createLogger } from "../src/shared/utils/log.js";

test("logger scopes messages and bounds once-only keys per level", () => {
  const originalConsoleMethods = {
    debug: console.debug,
    warn: console.warn,
    error: console.error,
  };
  const calls = [];
  for (const method of Object.keys(originalConsoleMethods)) {
    console[method] = (...args) => calls.push({ method, args });
  }

  try {
    const logger = createLogger("LoggingTest");
    logger.debug("debug", 1);
    logger.warn("warning", 2);
    logger.error("error", 3);
    logger.debugOnce("same", "first debug");
    logger.debugOnce("same", "duplicate debug");
    logger.warnOnce("same", "first warning");
    logger.warnOnce("same", "duplicate warning");
    logger.errorOnce("same", "first error");
    logger.errorOnce("same", "duplicate error");

    assert.deepEqual(calls.slice(0, 3), [
      { method: "debug", args: ["[MediaShell][LoggingTest]", "debug", 1] },
      { method: "warn", args: ["[MediaShell][LoggingTest]", "warning", 2] },
      { method: "error", args: ["[MediaShell][LoggingTest]", "error", 3] },
    ]);
    assert.deepEqual(calls.slice(3), [
      { method: "debug", args: ["[MediaShell][LoggingTest]", "first debug"] },
      { method: "warn", args: ["[MediaShell][LoggingTest]", "first warning"] },
      { method: "error", args: ["[MediaShell][LoggingTest]", "first error"] },
    ]);

    const evictionLogger = createLogger("EvictionTest");
    const before = calls.length;
    for (let index = 0; index <= 256; index++) evictionLogger.debugOnce(`key-${index}`, index);
    evictionLogger.debugOnce("key-0", "evicted");
    assert.equal(calls.length - before, 258);
  } finally {
    Object.assign(console, originalConsoleMethods);
  }
});
