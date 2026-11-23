import { requireUser, requireRole } from "./guards.js";

function queryToObject(searchParams) {
  const obj = {};
  for (const [key, value] of searchParams.entries()) {
    obj[key] = value;
  }
  return obj;
}

export function registerApiRoutes(router, { eventService, bookingService }) {
  // Public reads: browsing events needs no login.
  router.add("GET", "/api/events", async (_req, _res, ctx) => {
    const events = await eventService.searchEvents(queryToObject(ctx.query));
    ctx.sendJson(200, { events });
  });

  // Protected: the organizer dashboard. Registered before /api/events/:id so
  // the literal "mine" is not captured as an id.
  router.add("GET", "/api/events/mine", async (req, _res, ctx) => {
    const user = requireRole(requireUser(req), "organizer");
    const events = await eventService.listMyEvents(user);
    ctx.sendJson(200, { events });
  });

  router.add("GET", "/api/events/:id", async (_req, _res, ctx) => {
    const event = await eventService.getEvent(ctx.params.id);
    ctx.sendJson(200, event);
  });

  // Organizer-only writes. The token supplies identity AND role.
  router.add("POST", "/api/events", async (req, _res, ctx) => {
    const user = requireRole(requireUser(req), "organizer");
    const event = await eventService.createEvent(ctx.body ?? {}, user);
    ctx.sendJson(201, event);
  });

  router.add("POST", "/api/events/:id/tiers", async (req, _res, ctx) => {
    const user = requireRole(requireUser(req), "organizer");
    const tier = await eventService.addTier(ctx.params.id, ctx.body ?? {}, user);
    ctx.sendJson(201, tier);
  });

  router.add("POST", "/api/events/:id/publish", async (req, _res, ctx) => {
    const user = requireRole(requireUser(req), "organizer");
    const event = await eventService.publishEvent(ctx.params.id, user);
    ctx.sendJson(200, event);
  });

  router.add("POST", "/api/events/:id/unpublish", async (req, _res, ctx) => {
    const user = requireRole(requireUser(req), "organizer");
    const event = await eventService.unpublishEvent(ctx.params.id, user);
    ctx.sendJson(200, event);
  });

  // Attendee writes and private reads. Never trust a header for identity.
  router.add("POST", "/api/bookings", async (req, _res, ctx) => {
    const user = requireUser(req);
    const booking = await bookingService.bookTickets(ctx.body ?? {}, user);
    ctx.sendJson(201, booking);
  });

  router.add("GET", "/api/bookings", async (req, _res, ctx) => {
    const user = requireUser(req);
    const bookings = await bookingService.listMyBookings(user);
    ctx.sendJson(200, { bookings });
  });

  router.add("GET", "/api/bookings/:reference", async (req, _res, ctx) => {
    const user = requireUser(req);
    const booking = await bookingService.getBooking(ctx.params.reference, user);
    ctx.sendJson(200, booking);
  });

  router.add("POST", "/api/bookings/:reference/pay", async (req, _res, ctx) => {
    const user = requireUser(req);
    const booking = await bookingService.payBooking(
      ctx.params.reference,
      ctx.body ?? {},
      user,
    );
    ctx.sendJson(200, booking);
  });

  router.add("POST", "/api/bookings/:reference/cancel", async (req, _res, ctx) => {
    const user = requireUser(req);
    const booking = await bookingService.cancelBooking(ctx.params.reference, user);
    ctx.sendJson(200, booking);
  });
}
