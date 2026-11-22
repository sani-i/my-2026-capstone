import { DomainError } from "./errors.js";

export const BOOKING_STATES = Object.freeze([
  "pending",
  "paid",
  "cancelled",
  "refunded",
  "checked_in",
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  pending: Object.freeze(["paid", "cancelled"]),
  paid: Object.freeze(["checked_in", "refunded", "cancelled"]),
  cancelled: Object.freeze([]),
  refunded: Object.freeze([]),
  checked_in: Object.freeze([]),
});

export function canTransition(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `cannot transition booking from "${from}" to "${to}"`,
    );
  }
  return true;
}

export function getAllowedTransitions(from) {
  return Array.isArray(ALLOWED_TRANSITIONS[from]) ? [...ALLOWED_TRANSITIONS[from]] : [];
}
