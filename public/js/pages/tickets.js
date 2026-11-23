import { cancelBooking, listMyBookings, pay } from "../api.js";
import { requireLogin } from "../session.js";
import { clear, el, formatCents } from "../ui.js";

const statusEl = document.getElementById("status");
const listEl = document.getElementById("bookings-list");

if (requireLogin()) {
  function setStatus(message, type = "") {
    clear(statusEl);
    statusEl.className = `status ${type}`.trim();
    if (message) statusEl.append(document.createTextNode(message));
  }

  function renderActions(booking) {
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

      const cancelBtn = el("button", {
        type: "button",
        className: "secondary",
        onClick: async () => {
          cancelBtn.disabled = true;
          try {
            await cancelBooking(booking.reference);
            await load();
            setStatus("Booking cancelled; seats released.", "success");
          } catch (err) {
            setStatus(err?.message || "Could not cancel booking.", "error");
            cancelBtn.disabled = false;
          }
        },
      }, ["Cancel booking"]);

      actions.append(tokenSelect, payBtn, cancelBtn);
    }
    return actions;
  }

  function renderBooking(booking) {
    return el("article", { className: "card ticket" }, [
      el("h2", {}, [booking.reference]),
      el("p", { className: "meta" }, [`Event: ${booking.eventId}`]),
      el("p", { className: "meta" }, [`Quantity: ${booking.quantity} • Amount: ${formatCents(booking.amountCents)}`]),
      el("p", {}, [
        el("span", { className: `badge status-${booking.status}` }, [booking.status]),
      ]),
      renderActions(booking),
    ]);
  }

  async function load() {
    setStatus("Loading your bookings...");
    try {
      const { bookings } = await listMyBookings();
      clear(listEl);
      if (!bookings.length) {
        listEl.append(el("p", { className: "muted" }, ["You have no bookings yet."]));
        setStatus("");
        return;
      }
      for (const booking of bookings) listEl.append(renderBooking(booking));
      setStatus(`${bookings.length} booking(s).`);
    } catch (err) {
      clear(listEl);
      setStatus(err?.message || "Could not load bookings.", "error");
    }
  }

  load();
}
