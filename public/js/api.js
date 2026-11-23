import { getMockEvents } from "./mockData.js";

let events = getMockEvents();
const bookings = new Map(); // reference -> booking

function clone(v) {
  return structuredClone(v);
}

function normalize(str) {
  return String(str || "").toLowerCase().trim();
}

function summarizeEvent(event) {
  const tiers = event.tiers.map((t) => ({ ...t }));
  const prices = tiers.map((t) => t.priceCents);
  const cheapestPriceCents = prices.length ? Math.min(...prices) : null;
  const totalRemaining = tiers.reduce((sum, t) => sum + (t.seatsLeft ?? 0), 0);
  return { ...event, tiers, cheapestPriceCents, totalRemaining };
}

function makeReference() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "BK-";
  for (let i = 0; i < 8; i += 1) {
    if (i === 4) out += "-";
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export async function listEvents(params = {}) {
  let list = events.filter((e) => e.status === "published").map(summarizeEvent);

  const q = normalize(params.q);
  const city = normalize(params.city);
  const maxPriceCents = params.maxPriceCents;
  const sort = params.sort || "date";

  if (q) {
    list = list.filter((e) => normalize(e.title).includes(q) || normalize(e.venue).includes(q));
  }
  if (city) {
    list = list.filter((e) => normalize(e.city) === city);
  }
  if (maxPriceCents !== undefined && maxPriceCents !== "" && maxPriceCents !== null) {
    const max = Number(maxPriceCents);
    if (Number.isFinite(max)) {
      list = list.filter((e) => e.cheapestPriceCents !== null && e.cheapestPriceCents <= max);
    }
  }

  if (sort === "price") {
    list.sort((a, b) => {
      const ap = a.cheapestPriceCents ?? Number.POSITIVE_INFINITY;
      const bp = b.cheapestPriceCents ?? Number.POSITIVE_INFINITY;
      if (ap !== bp) return ap - bp;
      return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
  } else if (sort === "availability") {
    list.sort((a, b) => {
      if (a.totalRemaining !== b.totalRemaining) return b.totalRemaining - a.totalRemaining;
      return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
  } else {
    list.sort((a, b) => {
      const ad = Date.parse(a.startsAt);
      const bd = Date.parse(b.startsAt);
      if (ad !== bd) return ad - bd;
      return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
  }

  return { events: clone(list) };
}

export async function getEvent(id) {
  const event = events.find((e) => e.id === id);
  if (!event) {
    const err = new Error("Event not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  return clone(summarizeEvent(event));
}

export async function createBooking({ tierId, quantity }) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
    const err = new Error("quantity must be an integer between 1 and 10");
    err.code = "VALIDATION";
    throw err;
  }

  let foundTier;
  let foundEvent;
  for (const e of events) {
    const t = e.tiers.find((x) => x.id === tierId);
    if (t) { foundTier = t; foundEvent = e; break; }
  }
  if (!foundTier || !foundEvent) {
    const err = new Error("Tier not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (qty > foundTier.seatsLeft) {
    const err = new Error(`Only ${foundTier.seatsLeft} ticket(s) left in ${foundTier.name}`);
    err.code = "SOLD_OUT";
    throw err;
  }

  foundTier.seatsLeft -= qty;
  foundTier.sold += qty;

  const now = Date.now();
  const booking = {
    id: `book-${Math.random().toString(36).slice(2, 10)}`,
    reference: makeReference(),
    eventId: foundEvent.id,
    tierId: foundTier.id,
    userId: "demo-user",
    quantity: qty,
    amountCents: foundTier.priceCents * qty,
    status: "pending",
    createdAt: new Date(now).toISOString(),
    holdExpiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
  };
  bookings.set(booking.reference, booking);
  return clone(booking);
}

export async function pay({ reference, paymentToken }) {
  const booking = bookings.get(reference);
  if (!booking) {
    const err = new Error("Booking not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (booking.status === "paid") {
    const err = new Error("Booking is already paid");
    err.code = "INVALID_TRANSITION";
    throw err;
  }
  if (booking.status !== "pending") {
    const err = new Error("Invalid booking state");
    err.code = "INVALID_TRANSITION";
    throw err;
  }
  if (booking.holdExpiresAt && Date.parse(booking.holdExpiresAt) < Date.now()) {
    const err = new Error("Booking hold expired");
    err.code = "INVALID_STATE";
    throw err;
  }
  if (paymentToken === "tok_declined") {
    const err = new Error("Card declined");
    err.code = "PAYMENT_DECLINED";
    throw err;
  }
  if (paymentToken !== "tok_success") {
    const err = new Error("Card declined");
    err.code = "PAYMENT_DECLINED";
    throw err;
  }
  booking.status = "paid";
  booking.paidAt = new Date().toISOString();
  return clone(booking);
}
