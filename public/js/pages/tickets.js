import {
  acceptWaitlistOffer,
  cancelBooking,
  getCancelQuote,
  listMyBookings,
  listMyWaitlist,
  pay,
} from "../api.js";
import { requireLogin } from "../session.js";
import { clear, el, formatCents } from "../ui.js";

const statusEl = document.getElementById("status");
const listEl = document.getElementById("bookings-list");
const offersEl = document.getElementById("offers-list");

if (requireLogin()) {
  let offerTimer = null;

  function setStatus(message, type = "") {
    clear(statusEl);
    statusEl.className = `status ${type}`.trim();
    if (message) statusEl.append(document.createTextNode(message));
  }

  function makeCancelButton(booking, confirmSlot) {
    const cancelBtn = el("button", {
      type: "button",
      className: "secondary",
      onClick: askCancel,
    }, ["Cancel booking"]);

    async function askCancel() {
      cancelBtn.disabled = true;
      clear(confirmSlot);
      try {
        // Build 8: fetch and display the amount BEFORE asking for confirmation.
        const quote = await getCancelQuote(booking.reference);
        const detail = quote.status === "paid"
          ? `Refund amount: ${formatCents(quote.refundCents)} (${quote.percent}% of ${formatCents(quote.amountCents)}).`
          : "This booking is unpaid, so there is no refund. Your seats will be released.";

        const confirmBtn = el("button", {
          type: "button",
          className: "danger",
          onClick: async () => {
            confirmBtn.disabled = true;
            try {
              const cancelled = await cancelBooking(booking.reference);
              await load();
              const refund = cancelled.refundCents !== undefined
                ? ` Refund: ${formatCents(cancelled.refundCents)}.`
                : "";
              setStatus(`Booking cancelled; seats released.${refund}`, "success");
            } catch (err) {
              setStatus(err?.message || "Could not cancel booking.", "error");
              confirmBtn.disabled = false;
            }
          },
        }, ["Confirm cancel"]);

        const keepBtn = el("button", {
          type: "button",
          className: "secondary",
          onClick: () => {
            clear(confirmSlot);
            cancelBtn.disabled = false;
          },
        }, ["Keep booking"]);

        confirmSlot.className = "cancel-confirm";
        confirmSlot.append(
          el("p", { className: "refund-amount" }, [detail]),
          el("p", { className: "muted" }, ["Cancel this booking? This cannot be undone."]),
          el("div", { className: "actions" }, [confirmBtn, keepBtn]),
        );
      } catch (err) {
        setStatus(err?.message || "Could not get a refund quote.", "error");
        cancelBtn.disabled = false;
      }
    }

    return cancelBtn;
  }

  function renderActions(booking, confirmSlot) {
    const actions = el("div", { className: "actions" });
    if (booking.status === "pending") {
      const tokenSelect = el("select", { id: `card-${booking.reference}`, "aria-label": `Mock card for ${booking.reference}` }, [
        el("option", { value: "tok_success" }, ["tok_success (approved)"]),
        el("option", { value: "tok_declined" }, ["tok_declined (declined)"]),
      ]);
      const payBtn = el("button", {
        type: "button",
        onClick: async () => {
          payBtn.disabled = true;
          try {
            await pay({ reference: booking.reference, paymentToken: tokenSelect.value });
            await load();
            setStatus("Payment successful.", "success");
          } catch (err) {
            setStatus(err?.message || "Payment failed.", "error");
            payBtn.disabled = false;
          }
        },
      }, ["Pay now"]);

      actions.append(tokenSelect, payBtn);
    }

    if (booking.status === "pending" || booking.status === "paid") {
      actions.append(makeCancelButton(booking, confirmSlot));
    }
    return actions;
  }

  function renderBooking(booking) {
    const confirmSlot = el("div", { className: "cancel-slot" });
    return el("article", { className: "card ticket" }, [
      el("h2", {}, [booking.reference]),
      el("p", { className: "meta" }, [`Event: ${booking.eventId}`]),
      el("p", { className: "meta" }, [`Quantity: ${booking.quantity} • Amount: ${formatCents(booking.amountCents)}`]),
      booking.refundCents !== undefined
        ? el("p", { className: "meta" }, [`Refund: ${formatCents(booking.refundCents)}`])
        : false,
      el("p", {}, [
        el("span", { className: `badge status-${booking.status}` }, [booking.status]),
      ]),
      renderActions(booking, confirmSlot),
      confirmSlot,
    ]);
  }

  function countdownText(offerExpiresAt) {
    const remaining = Date.parse(offerExpiresAt || "") - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      return "Offer expired - check back for updates.";
    }
    const totalSeconds = Math.floor(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `Offer expires in ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function startOfferCountdown() {
    if (offerTimer) return;
    offerTimer = setInterval(() => {
      const nodes = offersEl.querySelectorAll("[data-offer-expiry]");
      if (nodes.length === 0) {
        clearInterval(offerTimer);
        offerTimer = null;
        return;
      }
      for (const node of nodes) {
        const text = countdownText(node.dataset.offerExpiry);
        if (node.textContent !== text) {
          clear(node);
          node.append(document.createTextNode(text));
        }
        node.classList.toggle("expired", text.startsWith("Offer expired"));
      }
    }, 1000);
  }

  function renderOffer(entry) {
    const countdownEl = el("p", {
      className: "countdown",
      dataset: { offerExpiry: entry.offerExpiresAt || "" },
    }, [countdownText(entry.offerExpiresAt)]);

    const acceptBtn = el("button", {
      type: "button",
      onClick: async () => {
        acceptBtn.disabled = true;
        try {
          const { booking } = await acceptWaitlistOffer(entry.id);
          setStatus(`Offer accepted. Booking ${booking.reference} is ready for payment.`, "success");
          await load();
        } catch (err) {
          if (err?.code === "OFFER_EXPIRED") {
            setStatus("That offer expired and was passed to the next person.", "error");
          } else {
            setStatus(err?.message || "Could not accept the offer.", "error");
          }
          await loadOffers();
          acceptBtn.disabled = false;
        }
      },
    }, ["Accept offer"]);

    return el("article", { className: "card ticket offer" }, [
      el("h2", {}, [`Seat offer - tier ${entry.tierId}`]),
      el("p", { className: "meta" }, [`Quantity: ${entry.quantity}`]),
      countdownEl,
      el("div", { className: "actions" }, [acceptBtn]),
    ]);
  }

  async function loadOffers() {
    try {
      const { entries } = await listMyWaitlist();
      clear(offersEl);
      const offers = entries.filter((entry) => entry.status === "offered");
      const waiting = entries.filter((entry) => entry.status === "waiting");
      if (offers.length === 0) {
        offersEl.append(el("p", { className: "muted" }, [
          waiting.length
            ? `You are on the waitlist (queue position #${waiting[0].position ?? "?"} for tier ${waiting[0].tierId}). No active offers yet.`
            : "No active offers right now.",
        ]));
        return;
      }
      for (const entry of offers) offersEl.append(renderOffer(entry));
      if (waiting.length) {
        offersEl.append(el("p", { className: "muted" }, [
          `Also waiting: ${waiting.length} tier(s).`,
        ]));
      }
      startOfferCountdown();
    } catch (err) {
      clear(offersEl);
      offersEl.append(el("p", { className: "error-msg" }, [err?.message || "Could not load offers."]));
    }
  }

  async function load() {
    setStatus("Loading your bookings...");
    try {
      const { bookings } = await listMyBookings();
      clear(listEl);
      if (!bookings.length) {
        listEl.append(el("p", { className: "muted" }, ["You have no bookings yet."]));
      } else {
        for (const booking of bookings) listEl.append(renderBooking(booking));
      }
      setStatus(`${bookings.length} booking(s).`);
    } catch (err) {
      clear(listEl);
      setStatus(err?.message || "Could not load bookings.", "error");
    }
    await loadOffers();
  }

  load();
}
