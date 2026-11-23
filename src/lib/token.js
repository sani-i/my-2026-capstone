import { createHmac, timingSafeEqual } from "node:crypto";

function base64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buf.toString("base64url");
}

function base64urlDecode(input) {
  return Buffer.from(String(input), "base64url");
}

const DEV_SECRET = "dev-only-secret-change-me-before-deploying";

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (typeof secret === "string" && secret.length >= 16) {
    return secret;
  }
  // Local development and tests work out of the box. Production must set
  // AUTH_SECRET explicitly, otherwise tokens would be signed with a known key.
  if (process.env.NODE_ENV === "production" || (typeof secret === "string" && secret.length > 0)) {
    throw new Error("AUTH_SECRET environment variable must be set (min 16 chars)");
  }
  return DEV_SECRET;
}

export function signToken(payload, { expiresInSeconds = 60 * 60 } = {}) {
  const secret = getSecret();
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(fullPayload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function verifyToken(token) {
  const secret = getSecret();
  if (typeof token !== "string" || token.trim().length === 0) {
    throw Object.assign(new Error("Missing token"), { code: "UNAUTHENTICATED" });
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw Object.assign(new Error("Invalid token"), { code: "UNAUTHENTICATED" });
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(base64urlDecode(encodedHeader).toString("utf8"));
    payload = JSON.parse(base64urlDecode(encodedPayload).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid token"), { code: "UNAUTHENTICATED" });
  }

  // Reject any token whose header says alg is anything but HS256.
  if (!header || header.alg !== "HS256") {
    throw Object.assign(new Error("Invalid token algorithm"), { code: "UNAUTHENTICATED" });
  }

  const data = `${encodedHeader}.${encodedPayload}`;
  const expected = createHmac("sha256", secret).update(data).digest("base64url");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw Object.assign(new Error("Invalid token signature"), { code: "UNAUTHENTICATED" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || now >= payload.exp) {
    throw Object.assign(new Error("Token expired"), { code: "UNAUTHENTICATED" });
  }

  return payload;
}
