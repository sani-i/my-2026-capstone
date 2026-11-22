import test from "node:test";
import assert from "node:assert/strict";
import {
  BOOKING_STATES,
  assertTransition,
  canTransition,
  getAllowedTransitions,
} from "../src/domain/bookingStateMachine.js";

const allowed = [
  ["pending", "paid"],
  ["pending", "cancelled"],
  ["paid", "checked_in"],
  ["paid", "refunded"],
  ["paid", "cancelled"],
];

test("every allowed booking move is accepted", () => {
  for (const [from, to] of allowed) {
    assert.equal(canTransition(from, to), true, `${from} -> ${to} should be allowed`);
    assert.equal(assertTransition(from, to), true);
  }
});

test("every illegal booking move is rejected with INVALID_TRANSITION", () => {
  const allowedSet = new Set(allowed.map(([f, t]) => `${f}->${t}`));
  for (const from of BOOKING_STATES) {
    for (const to of BOOKING_STATES) {
      const key = `${from}->${to}`;
      if (allowedSet.has(key)) continue;
      assert.equal(canTransition(from, to), false, `${key} should be illegal`);
      assert.throws(
        () => assertTransition(from, to),
        (err) => err?.name === "DomainError" && err?.code === "INVALID_TRANSITION",
        `${key} should throw INVALID_TRANSITION`,
      );
    }
  }
});

test("final states have no allowed transitions", () => {
  for (const state of ["cancelled", "refunded", "checked_in"]) {
    assert.deepEqual(getAllowedTransitions(state), []);
  }
});
