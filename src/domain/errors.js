/**
 * Domain error with a machine-readable code.
 * Codes used in Build 1: VALIDATION, NOT_FOUND, SOLD_OUT.
 */
export class DomainError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
export function fail(code, message) {
  throw new DomainError(code, message);
}
