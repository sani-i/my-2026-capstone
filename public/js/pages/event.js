import { createBooking, getEvent, joinWaitlist, listMyWaitlist, pay } from "../api.js";
import { requireLogin } from "../session.js";
import { clear, el, formatCents } from "../ui.js";

const statusEl = document.getElementById("status");
const detailEl = document.getElementById("event-detail");
const checkoutSection = document.getElementById("checkout-section");
const checkoutSummary = document.getElementById("checkout-summary");
const countdownEl = document.getElementById("countdown");
const paymentForm = document.getElementById("payment-form");
const paymentStatus = document.getElementById("payment-status");
const payBtn = document.getElementById("pay-btn");

let currentEvent = null;
let currentBooking = null;
let countdownTimer = null;
let myWaitlist = new Map();

function setStatus(message, type = "") {
  clear(statusEl);
  statusEl.className = `status ${type}`.trim();
  if (message) statusEl.append(document.createTextNode(message));
}

function setPaymentStatus(message, type = "") {
  clear(paymentStatus);
  paymentStatus.className = `status ${type}`.trim();
  if (message) paymentStatus.append(document.createTextNode(message));
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

function getEventId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function renderCheckout(booking) {
  currentBooking = booking;
  checkoutSection.classList.remove("hidden");
  clear(checkoutSummary);
  checkoutSummary.append(
    el("p", {}, [`Reference: ${booking.reference}`]),
    el("p", {}, [`Quantity: ${booking.quantity}`]),
    el("p", {}, [`Amount: ${formatCents(booking.amountCents)}`]),
    el("p", {}, [`Status: ${booking.status}`]),
  );
  setPaymentStatus("");
  payBtn.disabled = false;
  // The API returns createdAt; the 10-minute hold window is a display detail
  // here (server-side expiry belongs to a later build).
  const holdExpiresAt =
    booking.holdExpiresAt ||
    new Date(Date.parse(booking.createdAt) + 10 * 60 * 1000).toISOString();
  startCountdown(holdExpiresAt);
  checkoutSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function startCountdown(holdExpiresAt) {
  stopCountdown();
  const expiry = Date.parse(holdExpiresAt);
  function tick() {
    const remainingMs = expiry - Date.now();
    if (remainingMs <= 0) {
      clear(countdownEl);
      countdownEl.append(document.createTextNode("Seat hold expired. Please book again."));
      payBtn.disabled = true;
      stopCountdown();
      return;
    }
    const totalSeconds = Math.floor(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    clear(countdownEl);
    countdownEl.append(
      document.createTextNode(
        `Seats held for ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
      ),
    );
  }
  tick();
  countdownTimer = setInterval(tick, 1000);
}

async function handleBook(tier) {
  if (!requireLogin()) return;
  const qtyInput = document.getElementById(`qty-${tier.id}`);
  const qty = Number(qtyInput?.value);
  const max = Math.min(10, tier.seatsLeft);
  if (!Number.isInteger(qty) || qty < 1) {
    setStatus("Choose a quantity of at least 1.", "error");
    return;
  }
  if (qty > max) {
    setStatus(`You can book at most ${max} ticket(s) for this tier.`, "error");
    return;
  }
  setStatus("Creating booking...");
  try {
    const booking = await createBooking({ tierId: tier.id, quantity: qty });
    setStatus("Booking created. Complete payment before the hold expires.", "success");
    renderCheckout(booking);
    await loadEvent(currentEvent.id); // refresh seats
  } catch (err) {
    setStatus(err?.message || "Could not create booking.", "error");
  }
}

async function loadMyWaitlist() {
  try {
    const { entries } = await listMyWaitlist();
    myWaitlist = new Map(entries.map((entry) => [entry.tierId, entry]));
  } catch {
    // Not logged in (or session expired); sold-out tiers still show the button
    // and requireLogin() explains what to do.
    myWaitlist = new Map();
  }
}

async function handleWaitlistJoin(tier) {
  if (!requireLogin()) return;
  setStatus("Joining the waitlist...");
  try {
    await joinWaitlist({ tierId: tier.id, quantity: 1 });
    setStatus("You joined the waitlist. We will hold a seat for you when one frees up.", "success");
    await loadEvent(currentEvent.id);
  } catch (err) {
    if (err?.code === "ALREADY_ON_WAITLIST") {
      await loadMyWaitlist();
      renderEvent(currentEvent);
    }
    setStatus(err?.message || "Could not join the waitlist.", "error");
  }
}

function renderWaitlistAction(tier) {
  const entry = myWaitlist.get(tier.id);
  if (entry?.status === "offered") {
    return el("a", { className: "button-link", href: "/tickets.html" }, [
      "Seat offered - view offer",
    ]);
  }
  if (entry && ["waiting", "accepting", "accepted"].includes(entry.status)) {
    return el("button", { type: "button", className: "secondary", disabled: true }, [
      entry.position ? `On waitlist (#${entry.position})` : "On waitlist",
    ]);
  }
  return el("button", { type: "button", onClick: () => handleWaitlistJoin(tier) }, [
    "Join waitlist",
  ]);
}

function renderTier(tier) {
  const soldOut = tier.seatsLeft <= 0;
  const maxQty = Math.min(10, Math.max(0, tier.seatsLeft));
  const qtyId = `qty-${tier.id}`;

  const qtyInput = el("input", {
    id: qtyId,
    name: qtyId,
    type: "number",
    min: "1",
    max: String(Math.max(1, maxQty)),
    step: "1",
    value: soldOut ? "0" : "1",
    disabled: soldOut,
    inputmode: "numeric",
  });

  const action = soldOut
    ? renderWaitlistAction(tier)
    : el("button", { type: "button", onClick: () => handleBook(tier) }, ["Book tickets"]);

  return el("div", { className: `tier ${soldOut ? "sold-out" : ""}` }, [
    el("div", { className: "tier-header" }, [
      el("h3", {}, [tier.name]),
      el("span", { className: `badge ${soldOut ? "sold-out" : "available"}` }, [soldOut ? "Sold out" : `${tier.seatsLeft} seats left`]),
    ]),
    el("p", { className: "meta" }, [`Price: ${formatCents(tier.priceCents)}`]),
    el("p", { className: "meta" }, [`Capacity: ${tier.capacity} • Sold: ${tier.sold}`]),
    el("div", { className: "qty-row" }, [
      soldOut
        ? el("p", { className: "meta" }, ["No seats left - join the waitlist for the next one."])
        : el("div", { className: "field" }, [
            el("label", { htmlFor: qtyId }, ["Quantity"]),
            qtyInput,
          ]),
      action,
    ]),
  ]);
}

function renderEvent(event) {
  clear(detailEl);
  detailEl.append(
    el("h1", { id: "event-title" }, [event.title]),
    el("p", { className: "meta" }, [`${event.city} • ${event.venue}`]),
    el("p", { className: "meta" }, [formatDate(event.startsAt)]),
    el("p", { className: "meta" }, [`Status: ${event.status}`]),
    el("h2", {}, ["Ticket tiers"]),
    el("div", { className: "tiers" }, event.tiers.map(renderTier)),
  );
}

async function loadEvent(id) {
  try {
    const event = await getEvent(id);
    currentEvent = event;
    await loadMyWaitlist();
    renderEvent(event);
    if (!currentBooking) setStatus("");
  } catch (err) {
    setStatus(err?.message || "Failed to load event.", "error");
  }
}

paymentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentBooking) return;
  if (payBtn.disabled) return;

  setPaymentStatus("Processing payment...");
  payBtn.disabled = true;
  try {
    const token = document.getElementById("paymentToken").value;
    const paid = await pay({ reference: currentBooking.reference, paymentToken: token });
    currentBooking = paid;
    clear(checkoutSummary);
    checkoutSummary.append(
      el("p", { className: "success-msg" }, ["Payment successful!"]),
      el("p", {}, [`Reference: ${paid.reference}`]),
      el("p", {}, [`Amount: ${formatCents(paid.amountCents)}`]),
      el("p", {}, [`Status: ${paid.status}`]),
    );
    stopCountdown();
    clear(countdownEl);
    countdownEl.append(document.createTextNode("Booking confirmed."));
    setPaymentStatus("Your booking is confirmed.", "success");
  } catch (err) {
    if (err?.code === "PAYMENT_DECLINED") {
      setPaymentStatus("Card declined. Please try again with another token.", "error");
      payBtn.disabled = false; // allow retry
    } else {
      setPaymentStatus(err?.message || "Payment failed.", "error");
      const expired = String(err?.message || "").toLowerCase().includes("expired");
      payBtn.disabled = expired;
    }
  }
});

async function init() {
  const id = getEventId();
  if (!id) {
    setStatus("Missing event id. Go back to the events list.", "error");
    return;
  }
  setStatus("Loading event...");
  await loadEvent(id);
  setStatus("");
}

init();
