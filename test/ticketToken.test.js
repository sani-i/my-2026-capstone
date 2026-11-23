import test from "node:test";
import assert from "node:assert/strict";
import { signTicketToken, verifyTicketToken } from "../src/lib/ticketToken.js";

function decodePayload(code) {
  const [encoded] = code.split(".");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

test("signed ticket payload contains only a reference and issued-at time", () => {
  const code = signTicketToken({
    reference: "BK-ABCD-EFGH",
    issuedAtMs: Date.parse("2026-11-23T10:00:00Z"),
  });
  const payload = decodePayload(code);

  assert.deepEqual(Object.keys(payload).sort(), ["iat", "ref"]);
  assert.equal(payload.ref, "BK-ABCD-EFGH");
  assert.equal(payload.iat, Math.floor(Date.parse("2026-11-23T10:00:00Z") / 1000));
  assert.doesNotMatch(code, /attendee@example|john|email/i);
});

test("verify returns the reference for a valid code", () => {
  const code = signTicketToken({ reference: "BK-1234-5678", issuedAtMs: 1_765_000_000_000 });
  assert.deepEqual(verifyTicketToken(code), {
    reference: "BK-1234-5678",
    issuedAt: 1_765_000_000,
  });
});

test("edited, made-up or malformed codes are INVALID_TICKET", () => {
  const code = signTicketToken({ reference: "BK-AAAA-BBBB", issuedAtMs: 1_765_000_000_000 });
  const [payload, signature] = code.split(".");
  const editedSignature = `${signature.slice(0, -1)}${signature.at(-1) === "A" ? "B" : "A"}`;

  for (const bad of [
    `${payload}.${editedSignature}`,
    "made.up.code",
    "",
    null,
    `${Buffer.from('{"ref":"BK-AAAA-BBBB","iat":1,"email":"x@y.z"}').toString("base64url")}.${signature}`,
  ]) {
    assert.throws(() => verifyTicketToken(bad), (err) => err?.code === "INVALID_TICKET");
  }
});

test("production refuses to use the development ticket secret", () => {
  const previousEnv = process.env.NODE_ENV;
  const previousSecret = process.env.TICKET_SECRET;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.TICKET_SECRET;
    assert.throws(
      () => signTicketToken({ reference: "BK-AAAA-BBBB" }),
      /TICKET_SECRET environment variable must be set/,
    );
  } finally {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    if (previousSecret === undefined) delete process.env.TICKET_SECRET;
    else process.env.TICKET_SECRET = previousSecret;
  }
});
