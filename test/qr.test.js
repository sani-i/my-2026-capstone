import test from "node:test";
import assert from "node:assert/strict";
import { createQrCode } from "../public/js/qr.js";

test("createQrCode returns a square QR matrix with finder patterns", () => {
  const { size, modules } = createQrCode("BK-ABCD-EFGH.signed-code");

  assert.ok(size >= 21 && size <= 45);
  assert.equal(modules.length, size);
  for (const row of modules) assert.equal(row.length, size);

  const expectedFinder = [
    "1111111",
    "1000001",
    "1011101",
    "1011101",
    "1011101",
    "1000001",
    "1111111",
  ];
  const actual = modules.slice(0, 7).map((row) => row.slice(0, 7).map((v) => (v ? "1" : "0")).join(""));
  assert.deepEqual(actual, expectedFinder);
});

test("different payloads produce different matrices and output is deterministic", () => {
  const a = createQrCode("ticket-one");
  const aAgain = createQrCode("ticket-one");
  const b = createQrCode("ticket-two");

  assert.deepEqual(a.modules, aAgain.modules);
  assert.notDeepEqual(a.modules, b.modules);
});

test("payloads that are too long for the vendored encoder fail clearly", () => {
  assert.throws(() => createQrCode("x".repeat(400)), /too long/);
});
