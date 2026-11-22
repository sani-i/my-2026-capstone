import { randomBytes, randomUUID } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I

/**
 * Generate a unique internal id.
 * @returns {string}
 */
export function newId() {
  return randomUUID();
}

/**
 * Generate a short, readable booking reference safe to read aloud.
 * Format: BK-XXXX-XXXX (8 chars from an unambiguous alphabet).
 * @returns {string}
 */
export function newReference() {
  const bytes = randomBytes(8);
  let chars = "";
  for (let i = 0; i < 8; i += 1) {
    chars += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `BK-${chars.slice(0, 4)}-${chars.slice(4)}`;
}
