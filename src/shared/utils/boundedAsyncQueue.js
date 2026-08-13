/**
 * @file boundedAsyncQueue.js
 * @module shared.utils.boundedAsyncQueue
 *
 * Runs cancellable asynchronous work with a strict concurrency limit.
 */

function normalizeConcurrency(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.trunc(numericValue))
    : 1;
}

/** A small FIFO queue for expensive work owned by the Shell process. */
export default class BoundedAsyncQueue {
  #activeCount = 0;
  #maximumConcurrency;
  #pendingEntries = [];

  constructor(maximumConcurrency) {
    this.#maximumConcurrency = normalizeConcurrency(maximumConcurrency);
  }

  get activeCount() {
    return this.#activeCount;
  }

  get pendingCount() {
    return this.#pendingEntries.length;
  }

  enqueue(operation, cancelOperation = null) {
    if (typeof operation !== "function")
      throw new TypeError("A queued operation must be a function");

    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const entry = {
      operation,
      cancelOperation,
      resolvePromise,
      rejectPromise,
      state: "pending",
      cancellationRequested: false,
    };
    this.#pendingEntries.push(entry);
    this.#pump();

    return Object.freeze({
      promise,
      cancel: () => this.#cancel(entry),
    });
  }

  #cancel(entry) {
    if (entry.state === "settled") return;

    if (entry.state === "pending") {
      const entryIndex = this.#pendingEntries.indexOf(entry);
      if (entryIndex >= 0) this.#pendingEntries.splice(entryIndex, 1);
      entry.state = "settled";
      entry.resolvePromise(null);
      return;
    }

    if (entry.cancellationRequested) return;
    entry.cancellationRequested = true;
    entry.cancelOperation?.();
  }

  #pump() {
    while (
      this.#activeCount < this.#maximumConcurrency &&
      this.#pendingEntries.length > 0
    ) {
      const entry = this.#pendingEntries.shift();
      if (entry.state !== "pending") continue;

      entry.state = "active";
      this.#activeCount++;
      Promise.resolve()
        .then(entry.operation)
        .then(
          (value) => this.#settle(entry, entry.resolvePromise, value),
          (error) => this.#settle(entry, entry.rejectPromise, error),
        );
    }
  }

  #settle(entry, settlePromise, value) {
    if (entry.state !== "active") return;
    entry.state = "settled";
    this.#activeCount--;
    settlePromise(value);
    this.#pump();
  }
}
