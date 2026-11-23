import {
  addTier,
  createEvent,
  listMyEvents,
  publishEvent,
  unpublishEvent,
} from "../api.js";
import { currentUser, requireLogin } from "../session.js";
import { clear, el, formatCents } from "../ui.js";

const statusEl = document.getElementById("status");
const listEl = document.getElementById("events-list");
const form = document.getElementById("event-form");
const createBtn = document.getElementById("create-event-btn");

function setStatus(message, type = "") {
  clear(statusEl);
  statusEl.className = `status ${type}`.trim();
  if (message) statusEl.append(document.createTextNode(message));
}

if (requireLogin()) {
  const user = currentUser();
  if (user?.role !== "organizer") {
    // The server also checks the role on every organizer endpoint; this is
    // only a friendly message, not a security decision.
    setStatus("Only organizer accounts can use this page.", "error");
    form.classList.add("hidden");
  } else {
    function renderTier(tier) {
      return el("li", { className: "meta" }, [
        `${tier.name} — ${formatCents(tier.priceCents)}, ${tier.seatsLeft} of ${tier.capacity} left`,
      ]);
    }

    function renderTierForm(event, onDone) {
      const name = el("input", { type: "text", placeholder: "Tier name", required: true });
      const price = el("input", {
        type: "number",
        min: "0",
        step: "1",
        placeholder: "Price (cents)",
        required: true,
      });
      const capacity = el("input", {
        type: "number",
        min: "1",
        step: "1",
        placeholder: "Capacity",
        required: true,
      });
      const button = el("button", {
        type: "button",
        onClick: async () => {
          button.disabled = true;
          try {
            await addTier(event.id, {
              name: name.value.trim(),
              priceCents: Number(price.value),
              capacity: Number(capacity.value),
            });
            setStatus("Tier added.", "success");
            await onDone();
          } catch (err) {
            setStatus(err?.message || "Could not add tier.", "error");
            button.disabled = false;
          }
        },
      }, ["Add tier"]);
      return el("form", { className: "tier-form" }, [
        el("div", { className: "qty-row" }, [name, price, capacity, button]),
      ]);
    }

    function renderEvent(event, onChanged) {
      const toggleBtn = el("button", {
        type: "button",
        className: "secondary",
        onClick: async () => {
          toggleBtn.disabled = true;
          try {
            if (event.status === "published") {
              await unpublishEvent(event.id);
              setStatus("Event unpublished.", "success");
            } else {
              await publishEvent(event.id);
              setStatus("Event published.", "success");
            }
            await onChanged();
          } catch (err) {
            setStatus(err?.message || "Could not change event status.", "error");
            toggleBtn.disabled = false;
          }
        },
      }, [event.status === "published" ? "Unpublish" : "Publish"]);

      return el("article", { className: "card" }, [
        el("h3", {}, [event.title]),
        el("p", { className: "meta" }, [`${event.city} • ${event.venue}`]),
        el("p", {}, [el("span", { className: "badge" }, [event.status])]),
        el("h4", {}, ["Ticket tiers"]),
        event.tiers.length
          ? el("ul", {}, event.tiers.map(renderTier))
          : el("p", { className: "muted" }, ["No tiers yet."]),
        renderTierForm(event, onChanged),
        el("div", { className: "actions" }, [
          toggleBtn,
          el("a", { href: `/event.html?id=${encodeURIComponent(event.id)}` }, ["View public page"]),
        ]),
      ]);
    }

    async function load() {
      setStatus("Loading your events...");
      try {
        const { events } = await listMyEvents();
        clear(listEl);
        if (!events.length) {
          listEl.append(el("p", { className: "muted" }, ["You have no events yet. Create one above."]));
        } else {
          for (const event of events) listEl.append(renderEvent(event, load));
        }
        setStatus("");
      } catch (err) {
        clear(listEl);
        setStatus(err?.message || "Could not load events.", "error");
      }
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const startsAtValue = String(data.get("startsAt") || "");
      createBtn.disabled = true;
      try {
        await createEvent({
          title: String(data.get("title") || "").trim(),
          city: String(data.get("city") || "").trim(),
          venue: String(data.get("venue") || "").trim(),
          startsAt: startsAtValue ? new Date(startsAtValue).toISOString() : "",
        });
        form.reset();
        setStatus("Event created as a draft.", "success");
        await load();
      } catch (err) {
        setStatus(err?.message || "Could not create event.", "error");
      } finally {
        createBtn.disabled = false;
      }
    });

    load();
  }
}
