import { fail } from "./errors.js";
import { mergeSort } from "./sorting.js";

function assertArray(value, label) {
  if (!Array.isArray(value)) fail("VALIDATION", `${label} must be an array`);
}

function isDateOnly(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function parseDateBound(value, label, { endOfDayIfDateOnly = false } = {}) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("VALIDATION", `${label} must be a non-empty date string`);
  }
  const raw = value.trim();
  let ms;
  if (endOfDayIfDateOnly && isDateOnly(raw)) {
    ms = Date.parse(`${raw}T23:59:59.999Z`);
  } else {
    ms = Date.parse(raw);
  }
  if (Number.isNaN(ms)) {
    fail("VALIDATION", `${label} must be a valid date`);
  }
  return ms;
}

function assertWholeCents(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    fail("VALIDATION", `${label} must be a whole number of cents (integer >= 0)`);
  }
  return value;
}

function normalizeString(value) {
  return String(value ?? "").toLowerCase();
}

function eventStartMs(summary) {
  const ms = Date.parse(summary?.startsAt);
  return Number.isNaN(ms) ? NaN : ms;
}

/**
 * Filter event summaries. Pure: returns a new array, never mutates input.
 */
export function filterEvents(summaries, criteria = {}) {
  assertArray(summaries, "summaries");
  if (criteria === null || typeof criteria !== "object" || Array.isArray(criteria)) {
    fail("VALIDATION", "criteria must be an object");
  }

  const {
    q,
    city,
    from,
    to,
    maxPriceCents,
    onlyAvailable,
  } = criteria;

  if (q !== undefined && typeof q !== "string") {
    fail("VALIDATION", "q must be a string");
  }
  if (city !== undefined && typeof city !== "string") {
    fail("VALIDATION", "city must be a string");
  }
  if (onlyAvailable !== undefined && typeof onlyAvailable !== "boolean") {
    fail("VALIDATION", "onlyAvailable must be a boolean");
  }

  const fromMs = from === undefined ? undefined : parseDateBound(from, "from");
  const toMs =
    to === undefined ? undefined : parseDateBound(to, "to", { endOfDayIfDateOnly: true });
  const maxPrice =
    maxPriceCents === undefined ? undefined : assertWholeCents(maxPriceCents, "maxPriceCents");

  if (fromMs !== undefined && toMs !== undefined && fromMs > toMs) {
    fail("VALIDATION", "from must be before or equal to to");
  }

  const qNorm = q === undefined ? "" : q.trim().toLowerCase();
  const cityNorm = city === undefined ? "" : city.trim().toLowerCase();

  return summaries.filter((event) => {
    if (qNorm) {
      const title = normalizeString(event.title);
      const venue = normalizeString(event.venue);
      if (!title.includes(qNorm) && !venue.includes(qNorm)) return false;
    }

    if (cityNorm) {
      if (normalizeString(event.city) !== cityNorm) return false;
    }

    if (fromMs !== undefined || toMs !== undefined) {
      const startMs = eventStartMs(event);
      if (Number.isNaN(startMs)) return false;
      if (fromMs !== undefined && startMs < fromMs) return false;
      if (toMs !== undefined && startMs > toMs) return false;
    }

    if (maxPrice !== undefined) {
      const cheapest = event.cheapestPriceCents;
      // Events with no tiers are left out of price filters.
      if (cheapest === null || cheapest === undefined) return false;
      if (!Number.isInteger(cheapest)) return false;
      if (cheapest > maxPrice) return false;
    }

    if (onlyAvailable === true) {
      const remaining = Number(event.totalRemaining ?? 0);
      if (!(remaining > 0)) return false;
    }

    return true;
  });
}

function compareTitleThenId(a, b) {
  const titleCmp = String(a?.title ?? "").localeCompare(String(b?.title ?? ""));
  if (titleCmp !== 0) return titleCmp;
  return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
}

/**
 * Sort event summaries. Pure: returns a new array, never mutates input.
 * sortBy: 'date' | 'price' | 'availability'
 */
export function sortEvents(summaries, sortBy) {
  assertArray(summaries, "summaries");
  const allowed = ["date", "price", "availability"];
  if (typeof sortBy !== "string" || !allowed.includes(sortBy)) {
    fail("VALIDATION", `sortBy must be one of: ${allowed.join(", ")}`);
  }

  const compare = (a, b) => {
    if (sortBy === "date") {
      const aMs = eventStartMs(a);
      const bMs = eventStartMs(b);
      const aValid = !Number.isNaN(aMs);
      const bValid = !Number.isNaN(bMs);
      if (aValid && bValid && aMs !== bMs) return aMs - bMs;
      if (aValid !== bValid) return aValid ? -1 : 1;
      return compareTitleThenId(a, b);
    }

    if (sortBy === "price") {
      const aPrice = a?.cheapestPriceCents;
      const bPrice = b?.cheapestPriceCents;
      const aHas = Number.isInteger(aPrice);
      const bHas = Number.isInteger(bPrice);
      if (aHas && bHas && aPrice !== bPrice) return aPrice - bPrice;
      if (aHas !== bHas) return aHas ? -1 : 1; // no price last
      return compareTitleThenId(a, b);
    }

    // availability: most seats left first
    const aRem = Number(a?.totalRemaining ?? 0);
    const bRem = Number(b?.totalRemaining ?? 0);
    if (aRem !== bRem) return bRem - aRem;
    return compareTitleThenId(a, b);
  };

  return mergeSort(summaries, compare);
}

/**
 * Filter then sort. Pure.
 */
export function searchEvents(summaries, criteria = {}, sortBy = "date") {
  const filtered = filterEvents(summaries, criteria);
  return sortEvents(filtered, sortBy);
}
