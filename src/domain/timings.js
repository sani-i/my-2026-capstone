/** Durations used by the Build 8 hold and waitlist rules. */
export const MINUTE_MS = 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** How long an unpaid booking holds its seats before the expiry job cancels it. */
export const HOLD_MS = 10 * MINUTE_MS;

/** How long the first person on the waitlist has to accept a freed seat. */
export const OFFER_MS = 15 * MINUTE_MS;
