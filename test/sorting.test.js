import test from "node:test";
import assert from "node:assert/strict";
import { mergeSort } from "../src/domain/sorting.js";

test("mergeSort returns a new array and does not mutate input", () => {
  const input = [3, 1, 2];
  const copy = [...input];
  const out = mergeSort(input, (a, b) => a - b);
  assert.deepEqual(out, [1, 2, 3]);
  assert.deepEqual(input, copy);
  assert.notEqual(out, input);
});

test("mergeSort is stable (equal items keep their original order)", () => {
  const input = [
    { name: "a", day: 1 },
    { name: "b", day: 2 },
    { name: "c", day: 1 },
    { name: "d", day: 2 },
  ];
  const out = mergeSort(input, (x, y) => x.day - y.day);
  assert.deepEqual(out.map((x) => x.name), ["a", "c", "b", "d"]);
});

test("mergeSort handles empty list", () => {
  const input = [];
  const out = mergeSort(input, (a, b) => a - b);
  assert.deepEqual(out, []);
  assert.notEqual(out, input);
});

test("mergeSort handles single element", () => {
  const input = [42];
  const out = mergeSort(input, (a, b) => a - b);
  assert.deepEqual(out, [42]);
  assert.notEqual(out, input);
});
