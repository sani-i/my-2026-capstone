import { fail } from "../domain/errors.js";
import { OFFER_MS } from "../domain/timings.js";

/**
 * Owns the "a freed seat is held for the next person" rule. When an offer is
 * made we really reserve the seats in the tier, so nobody else can buy them
 * while the waitlist member decides.
 */
export function createSeatService(repo, { clock, offerMs = OFFER_MS } = {}) {
  if (!repo) fail("VALIDATION", "repo is required");
  if (!clock || typeof clock.nowMs !== "function") fail("VALIDATION", "clock is required");

  function isExpired(entry) {
    return Boolean(
      entry?.offerExpiresAt && Date.parse(entry.offerExpiresAt) <= clock.nowMs(),
    );
  }

  async function expireOffer(entryId) {
    const entry = await repo.getWaitlistEntryById(entryId);
    if (!entry || entry.status !== "offered" || !isExpired(entry)) return null;

    // Claim the expiry first. Without this compare-and-set, a user accepting
    // at the same instant as the job could release the same seats twice.
    const claimed = await repo.compareAndSetWaitlistStatus(entry.id, "offered", "expired", {
      expiredAt: clock.nowIso(),
      offerExpiresAt: entry.offerExpiresAt,
    });
    if (!claimed) return null;

    // Give the held seats back, then immediately try the next person. The
    // net effect on tier.sold is zero when there is another taker.
    await repo.releaseSeats(entry.tierId, entry.quantity);
    const expired = await repo.saveWaitlistEntry(claimed);
    const nextOffer = await offerNext(entry.tierId);
    return { expired, nextOffer };
  }

  async function offerNext(tierId) {
    // An expired offer that the job has not reached yet must not block the queue.
    const currentOffers = await repo.listWaitlistEntries({ tierId, status: "offered" });
    for (const offer of currentOffers) {
      if (isExpired(offer)) await expireOffer(offer.id);
    }

    const stillOffered = await repo.listWaitlistEntries({ tierId, status: "offered" });
    if (stillOffered.length > 0) return stillOffered[0];

    const waiting = await repo.listWaitlistEntries({ tierId, status: "waiting" });
    if (waiting.length === 0) return null;
    const next = waiting[0]; // createdAt then insertion order = FIFO

    try {
      await repo.reserveSeats(tierId, next.quantity);
    } catch (err) {
      if (err?.code === "SOLD_OUT") return null; // another buyer took it
      throw err;
    }

    next.status = "offered";
    next.offerExpiresAt = new Date(clock.nowMs() + offerMs).toISOString();
    return repo.saveWaitlistEntry(next);
  }

  async function expireStaleOffers() {
    const offers = await repo.listWaitlistEntries({ status: "offered" });
    const results = [];
    for (const offer of offers) {
      if (isExpired(offer)) {
        const result = await expireOffer(offer.id);
        if (result) results.push(result);
      }
    }
    return results;
  }

  async function offerNextForAllTiers() {
    const tiers = await repo.listTiers();
    const offers = [];
    for (const tier of tiers) {
      const offer = await offerNext(tier.id);
      if (offer) offers.push(offer);
    }
    return offers;
  }

  return { offerNext, expireOffer, expireStaleOffers, offerNextForAllTiers, isExpired };
}
