import { listEvents } from "../api.js";
import { clear, el, formatCents } from "../ui.js";

const form = document.getElementById("filters-form");
const resetBtn = document.getElementById("reset-filters");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("events-list");

function setStatus(message, type = "") {
  clear(statusEl);
  statusEl.className = `status ${type}`.trim();
  if (message) statusEl.append(document.createTextNode(message));
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

function readFilters() {
  const data = new FormData(form);
  const maxRaw = data.get("maxPriceCents");
  return {
    q: String(data.get("q") || "").trim(),
    city: String(data.get("city") || "").trim(),
    maxPriceCents: String(maxRaw || "").trim(),
    sort: String(data.get("sort") || "date"),
  };
}

function renderEvents(events) {
  clear(listEl);
  if (!events.length) {
    listEl.append(el("p", { className: "muted", text: "No events match your filters." }));
    return;
  }

  for (const event of events) {
    const cheapest = event.cheapestPriceCents !== null ? formatCents(event.cheapestPriceCents) : "No tiers";
    const card = el("article", { className: "card" }, [
      el("h2", {}, [event.title]),
      el("p", { className: "meta" }, [`${event.city} • ${event.venue}`]),
      el("p", { className: "meta" }, [formatDate(event.startsAt)]),
      el("p", { className: "meta" }, [`From ${cheapest}`]),
      el("p", { className: "meta" }, [`Seats left: ${event.totalRemaining}`]),
      el("p", {}, [
        el("a", { href: `/event.html?id=${encodeURIComponent(event.id)}` }, ["View event"]),
      ]),
    ]);
    listEl.append(card);
  }
}

async function load() {
  setStatus("Loading events...");
  try {
    const filters = readFilters();
    const params = {};
    if (filters.q) params.q = filters.q;
    if (filters.city) params.city = filters.city;
    if (filters.maxPriceCents !== "") params.maxPriceCents = filters.maxPriceCents;
    if (filters.sort) params.sort = filters.sort;
    const { events } = await listEvents(params);
    setStatus(`${events.length} event(s) found.`);
    renderEvents(events);
  } catch (err) {
    setStatus(err?.message || "Failed to load events.", "error");
    clear(listEl);
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  load();
});

resetBtn.addEventListener("click", () => {
  form.reset();
  load();
});

load();
