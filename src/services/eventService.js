import { fail } from "../domain/errors.js";
import { filterEvents, sortEvents } from "../domain/eventSearch.js";

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("VALIDATION", `${label} must be an object`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("VALIDATION", `${label} must be a non-empty string`);
  }
  return value.trim();
}

function assertIsoDate(value, label) {
  const str = assertNonEmptyString(value, label);
  if (Number.isNaN(Date.parse(str))) {
    fail("VALIDATION", `${label} must be a valid date`);
  }
  return str;
}

function assertWholeCents(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    fail("VALIDATION", `${label} must be a whole number of cents (integer >= 0)`);
  }
  return value;
}

function assertPositiveInt(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    fail("VALIDATION", `${label} must be a positive integer`);
  }
  return value;
}

function requireUserId(userId) {
  if (typeof userId !== "string" || userId.trim().length === 0) {
    fail("UNAUTHENTICATED", "x-user-id header is required");
  }
  return userId.trim();
}

function assertOrganizer(event, userId) {
  if (event.organizerId !== userId) {
    fail("FORBIDDEN", "You do not own this event");
  }
}

function tierSummary(tier) {
  return {
    id: tier.id,
    eventId: tier.eventId,
    name: tier.name,
    priceCents: tier.priceCents,
    capacity: tier.capacity,
    sold: tier.sold,
    seatsLeft: Math.max(0, tier.capacity - tier.sold),
  };
}

function eventWithTiers(event, tiers) {
  return { ...event, tiers: tiers.map(tierSummary) };
}

function toSearchSummary(event, tiers) {
  const tierSummaries = tiers.map(tierSummary);
  const prices = tierSummaries.map((t) => t.priceCents);
  return {
    id: event.id,
    title: event.title,
    city: event.city,
    venue: event.venue,
    startsAt: event.startsAt,
    status: event.status,
    organizerId: event.organizerId,
    tiers: tierSummaries,
    cheapestPriceCents: prices.length > 0 ? Math.min(...prices) : null,
    totalRemaining: tierSummaries.reduce((sum, t) => sum + t.seatsLeft, 0),
  };
}

export function createEventService(repo) {
  if (!repo) fail("VALIDATION", "repo is required");

  async function createEvent(input, userId) {
    const uid = requireUserId(userId);
    assertObject(input, "input");
    const title = assertNonEmptyString(input.title, "title");
    const city = assertNonEmptyString(input.city, "city");
    const venue = assertNonEmptyString(input.venue, "venue");
    const startsAt = assertIsoDate(input.startsAt, "startsAt");

    const event = await repo.createEvent({
      organizerId: uid,
      title,
      city,
      venue,
      startsAt,
    });
    return eventWithTiers(event, []);
  }

  async function addTier(eventId, input, userId) {
    const uid = requireUserId(userId);
    assertNonEmptyString(eventId, "eventId");
    assertObject(input, "input");
    const name = assertNonEmptyString(input.name, "name");
    const priceCents = assertWholeCents(input.priceCents, "priceCents");
    const capacity = assertPositiveInt(input.capacity, "capacity");

    const event = await repo.getEventById(eventId);
    if (!event) fail("NOT_FOUND", `event not found: ${eventId}`);
    assertOrganizer(event, uid);

    const tier = await repo.createTier({
      eventId: event.id,
      name,
      priceCents,
      capacity,
    });
    return tierSummary(tier);
  }

  async function publishEvent(eventId, userId) {
    const uid = requireUserId(userId);
    assertNonEmptyString(eventId, "eventId");
    const event = await repo.getEventById(eventId);
    if (!event) fail("NOT_FOUND", `event not found: ${eventId}`);
    assertOrganizer(event, uid);
    const tiers = await repo.listTiersByEventId(event.id);
    if (tiers.length === 0) {
      fail("INVALID_STATE", "cannot publish an event with no ticket tiers");
    }
    event.status = "published";
    const saved = await repo.saveEvent(event);
    return eventWithTiers(saved, tiers);
  }

  async function unpublishEvent(eventId, userId) {
    const uid = requireUserId(userId);
    assertNonEmptyString(eventId, "eventId");
    const event = await repo.getEventById(eventId);
    if (!event) fail("NOT_FOUND", `event not found: ${eventId}`);
    assertOrganizer(event, uid);
    event.status = "draft";
    const saved = await repo.saveEvent(event);
    const tiers = await repo.listTiersByEventId(event.id);
    return eventWithTiers(saved, tiers);
  }

  async function getEvent(eventId) {
    assertNonEmptyString(eventId, "eventId");
    const event = await repo.getEventById(eventId);
    if (!event) fail("NOT_FOUND", `event not found: ${eventId}`);
    const tiers = await repo.listTiersByEventId(event.id);
    return eventWithTiers(event, tiers);
  }

  async function searchEvents(query = {}) {
    assertObject(query, "query");
    const events = await repo.listEvents();
    const summaries = [];
    for (const event of events) {
      if (event.status !== "published") continue;
      const tiers = await repo.listTiersByEventId(event.id);
      summaries.push(toSearchSummary(event, tiers));
    }

    const criteria = {};
    if (query.q !== undefined) criteria.q = String(query.q);
    if (query.city !== undefined) criteria.city = String(query.city);
    if (query.from !== undefined) criteria.from = String(query.from);
    if (query.to !== undefined) criteria.to = String(query.to);
    if (query.onlyAvailable !== undefined) {
      const v = String(query.onlyAvailable).toLowerCase();
      criteria.onlyAvailable = v === "true" || v === "1";
    }
    if (query.maxPriceCents !== undefined) {
      const raw = String(query.maxPriceCents);
      if (!/^-?\d+$/.test(raw)) {
        fail("VALIDATION", "maxPriceCents must be a whole number of cents (integer >= 0)");
      }
      criteria.maxPriceCents = Number(raw);
    }

    const sortBy = query.sort === undefined ? "date" : String(query.sort);
    const filtered = filterEvents(summaries, criteria);
    return sortEvents(filtered, sortBy);
  }

  return {
    createEvent,
    addTier,
    publishEvent,
    unpublishEvent,
    getEvent,
    searchEvents,
  };
}
