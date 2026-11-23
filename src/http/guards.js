import { fail } from "../domain/errors.js";
import { verifyToken } from "../lib/token.js";

export function getBearerToken(req) {
  const header = req.headers["authorization"];
  if (typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

export function requireUser(req) {
  const token = getBearerToken(req);
  if (!token) {
    fail("UNAUTHENTICATED", "Missing or invalid bearer token");
  }
  try {
    const payload = verifyToken(token);
    if (!payload?.sub || !payload?.role) {
      fail("UNAUTHENTICATED", "Invalid token payload");
    }
    return {
      id: String(payload.sub),
      email: String(payload.email || ""),
      role: String(payload.role),
    };
  } catch (err) {
    if (err?.code === "UNAUTHENTICATED") throw err;
    fail("UNAUTHENTICATED", "Invalid or expired token");
  }
}

export function requireRole(user, roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(user.role)) {
    fail("FORBIDDEN", "Insufficient role");
  }
  return user;
}
