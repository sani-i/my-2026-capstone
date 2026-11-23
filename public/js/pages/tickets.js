import {
  acceptWaitlistOffer,
  cancelBooking,
  getCancelQuote,
  getTicket,
  listMyBookings,
  listMyWaitlist,
  pay,
} from "../api.js";
import { requireLogin } from "../session.js";
import { clear, el, formatCents } from "../ui.js";
import { createQrCode } from "../qr.js";

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

  /** Build 9: draw the signed ticket code as a crisp SVG QR code. */
  function renderQrSvg(code) {
    const { size, modules } = createQrCode(code);
    const quiet = 4;
    const dimension = size + quiet * 2;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${dimension} ${dimension}`);
    svg.setAttribute("width", "220");
    svg.setAttribute("height", "220");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Signed ticket QR code");
    svg.setAttribute("shape-rendering", "crispEdges");

    const background = document.createElementNS(ns, "rect");
    background.setAttribute("x", "0");
    background.setAttribute("y", "0");
    background.setAttribute("width", String(dimension));
    background.setAttribute("height", String(dimension));
    background.setAttribute("fill", "#ffffff");
    svg.append(background);

    const segments = [];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (modules[y][x]) {
          segments.push(`M${x + quiet},${y + quiet}h1v1h-1z`);
        }
      }
    }
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", segments.join(" "));
    path.setAttribute("fill", "#111827");
    svg.append(path);
    return svg;
  }

  async function loadTicketQr(booking, slot) {
    if (!["paid", "checked_in"].includes(booking.status)) return;
    try {
      const ticket = await getTicket(booking.reference);
      clear(slot);
      slot.className = "qr-card";
      slot.append(
        el("h3", {}, ["Your QR ticket"]),
        renderQrSvg(ticket.code),
        el("p", { className: "meta" }, [
          "The code contains only a signed booking reference, never your name or email.",
        ]),
      );
      if (ticket.status === "checked_in") {
        slot.append(el("p", { className: "success-msg" }, [
          `Checked in at ${ticket.checkedInAt || "a previous scan"}.`,
        ]));
      }
    } catch (err) {
      clear(slot);
      slot.append(el("p", { className: "error-msg" }, [
        err?.message || "Could not load your QR ticket.",
      ]));
    }
  }

  function renderBooking(booking) {
    const confirmSlot = el("div", { className: "cancel-slot" });
    const qrSlot = el("div", { className: "qr-slot" });
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
      qrSlot,
      confirmSlot,
    ]);
  }

  function renderBookingWithQr(booking) {
    const card = renderBooking(booking);
    const qrSlot = card.querySelector(".qr-slot");
    if (qrSlot) loadTicketQr(booking, qrSlot);
    return card;
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
        for (const booking of bookings) listEl.append(renderBookingWithQr(booking));
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
