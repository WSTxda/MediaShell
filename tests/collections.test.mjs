/**
 * @file collections.test.mjs
 * @module tests.collections
 *
 * Tests validated mutations provided by shared collection helpers.
 *
 * Reorderable preferences widgets depend on these edge cases but the helper is
 * pure, so invalid drag indexes and both move directions can be covered in Node.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { moveArrayItem } from "../src/shared/utils/collections.js";

test("array items move to an exact final index", () => {
  const values = ["first", "second", "third"];
  assert.equal(moveArrayItem(values, 0, 2), true);
  assert.deepEqual(values, ["second", "third", "first"]);
  assert.equal(moveArrayItem(values, 2, 0), true);
  assert.deepEqual(values, ["first", "second", "third"]);
});

test("invalid array moves leave the collection unchanged", () => {
  const values = ["first", "second"];
  for (const [sourceIndex, targetIndex] of [
    [-1, 0],
    [0, -1],
    [2, 0],
    [0, 2],
    [0, 0],
    [0.5, 1],
  ])
    assert.equal(moveArrayItem(values, sourceIndex, targetIndex), false);

  assert.equal(moveArrayItem(null, 0, 1), false);
  assert.deepEqual(values, ["first", "second"]);
});
