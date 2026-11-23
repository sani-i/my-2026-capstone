import { createHmac, timingSafeEqual } from "node:crypto";
import { fail } from "../domain/errors.js";

/**
 * Build 9: signed ticket codes for QR check-in.
 *
 * The payload contains ONLY a booking reference and an issued-at time. No name,
 * email or other personal data is put in a code that a camera can read.
 * This secret is deliberately different from the login token secret.
 */
const DEV_SECRET = "dev-only-ticket-secret-change-me-before-deploying";

function getSecret() {
  const secret = process.env.TICKET_SECRET;
  if (typeof secret === "string" && secret.length >= 16) return secret;

  // Production must never fall back to a value that is published in the repo.
  if (process.env.NODE_ENV === "production" || (typeof secret === "string" && secret.length > 0)) {
    throw new Error("TICKET_SECRET environment variable must be set (min 16 chars)");
  }
  return DEV_SECRET;
}

function base64urlEncode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64urlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signatureFor(data, secret) {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/**
 * @param {{ reference: string, issuedAtMs?: number }} input
 * @returns {string} a compact `payload.signature` code
 */
export function signTicketToken({ reference, issuedAtMs = Date.now() } = {}) {
  if (typeof reference !== "string" || reference.trim().length === 0) {
    fail("VALIDATION", "reference is required to sign a ticket");
  }
  if (!Number.isFinite(issuedAtMs) || issuedAtMs < 0) {
    fail("VALIDATION", "issuedAtMs must be a valid timestamp");
  }

  const payload = { ref: reference.trim(), iat: Math.floor(issuedAtMs / 1000) };
  const encoded = base64urlEncode(JSON.stringify(payload));
  return `${encoded}.${signatureFor(encoded, getSecret())}`;
}

/**
 * Verify the signature in constant time and return the payload.
 * Any malformed, edited or made-up code throws `INVALID_TICKET`.
 */
export function verifyTicketToken(token) {
  if (typeof token !== "string" || token.trim().length === 0) {
    fail("INVALID_TICKET", "Invalid ticket code");
  }
  const parts = token.trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    fail("INVALID_TICKET", "Invalid ticket code");
  }

  const [encoded, signature] = parts;
  const expected = signatureFor(encoded, getSecret());
  const actualBuf = Buffer.from(signature, "base64url");
  const expectedBuf = Buffer.from(expected, "base64url");
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    fail("INVALID_TICKET", "Invalid ticket code");
  }

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(encoded));
  } catch {
    fail("INVALID_TICKET", "Invalid ticket code");
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).sort().join(",") !== "iat,ref" ||
    typeof payload.ref !== "string" ||
    payload.ref.trim().length === 0 ||
    !Number.isInteger(payload.iat) ||
    payload.iat < 0
  ) {
    fail("INVALID_TICKET", "Invalid ticket code");
  }
  return { reference: payload.ref, issuedAt: payload.iat };
}
