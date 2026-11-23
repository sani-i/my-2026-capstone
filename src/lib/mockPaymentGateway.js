/**
 * Mock payment gateway. Never sees a card number.
 * Accepts a payment token: "tok_success" succeeds, "tok_declined" declines.
 */
export function createMockPaymentGateway() {
  return {
    async charge({ amountCents, paymentToken, reference }) {
      if (!Number.isInteger(amountCents) || amountCents < 0) {
        return { ok: false, code: "PAYMENT_DECLINED", message: "Invalid amount" };
      }
      if (typeof paymentToken !== "string" || paymentToken.trim().length === 0) {
        return { ok: false, code: "PAYMENT_DECLINED", message: "Missing payment token" };
      }
      if (paymentToken === "tok_declined") {
        return { ok: false, code: "PAYMENT_DECLINED", message: "Card declined" };
      }
      if (paymentToken === "tok_success") {
        return {
          ok: true,
          chargeId: `ch_${String(reference || "unknown").replace(/[^a-zA-Z0-9]/g, "")}`,
        };
      }
      // Unknown tokens decline safely.
      return { ok: false, code: "PAYMENT_DECLINED", message: "Card declined" };
    },

    /**
     * Build 8: the mock gateway also handles refunds. It never sees a card
     * number, only the original charge id and a whole-cent amount.
     */
    async refund({ chargeId, amountCents, refundCents, reference }) {
      if (!Number.isInteger(refundCents) || refundCents < 0 || refundCents > amountCents) {
        return { ok: false, code: "REFUND_FAILED", message: "Invalid refund amount" };
      }
      return {
        ok: true,
        refundId: `rf_${String(chargeId || reference || "unknown").replace(/[^a-zA-Z0-9]/g, "")}`,
      };
    },
  };
}
