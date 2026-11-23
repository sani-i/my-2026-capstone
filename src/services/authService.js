import { randomUUID } from "node:crypto";
import { fail } from "../domain/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { signToken } from "../lib/token.js";

const ROLES = ["attendee", "organizer", "staff"];

function normalizeEmail(email) {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

/** Never expose the password hash (or any password) in a response. */
function publicUser(user) {
  return {
    id: user.id,
    name: user.name || "",
    email: user.email,
    role: user.role,
  };
}

export function createAuthService(repo) {
  if (!repo || typeof repo.getUserByEmail !== "function") {
    fail("VALIDATION", "authService requires a user-aware repository");
  }

  async function signup(input) {
    const email = normalizeEmail(input?.email);
    const password = input?.password;
    const role = input?.role ?? "attendee";

    if (!email || !email.includes("@")) {
      fail("VALIDATION", "A valid email is required");
    }
    if (typeof password !== "string" || password.length < 8) {
      fail("VALIDATION", "Password must be at least 8 characters");
    }
    if (!ROLES.includes(role)) {
      fail("VALIDATION", "role must be attendee, organizer or staff");
    }

    const existing = await repo.getUserByEmail(email);
    if (existing) fail("EMAIL_TAKEN", "Email is already registered");

    const name = typeof input?.name === "string" ? input.name.trim() : "";
    const user = await repo.createUser({
      id: `user-${randomUUID()}`,
      name,
      email,
      passwordHash: hashPassword(password),
      role,
    });

    const token = signToken({ sub: user.id, email: user.email, role: user.role });
    return { token, user: publicUser(user) };
  }

  async function login(input) {
    const email = normalizeEmail(input?.email);
    const password = input?.password;
    if (!email || typeof password !== "string") {
      fail("INVALID_CREDENTIALS", "Invalid email or password");
    }

    const user = await repo.getUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      fail("INVALID_CREDENTIALS", "Invalid email or password");
    }

    const token = signToken({ sub: user.id, email: user.email, role: user.role });
    return { token, user: publicUser(user) };
  }

  async function me(user) {
    const fresh = await repo.getUserById?.(user.id);
    return publicUser(fresh || user);
  }

  return { signup, login, me };
}
