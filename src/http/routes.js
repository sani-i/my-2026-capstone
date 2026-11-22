function getUserId(req) {
  const v = req.headers["x-user-id"];
  return typeof v === "string" ? v : undefined;
}

function queryToObject(searchParams) {
  const obj = {};
  for (const [key, value] of searchParams.entries()) {
    obj[key] = value;
  }
  return obj;
}

export function registerApiRoutes(router, { eventService, bookingService }) {
  // POST /api/events
  router.add("POST", "/api/events", async (req, _res, ctx) => {
    const event = await eventService.createEvent(ctx.body ?? {}, getUserId(req));
    ctx.sendJson(201, event);
  });

  // POST /api/events/:id/tiers
  router.add("POST", "/api/events/:id/tiers", async (req, _res, ctx) => {
    const tier = await eventService.addTier(ctx.params.id, ctx.body ?? {}, getUserId(req));
    ctx.sendJson(201, tier);
  });

  // POST /api/events/:id/publish
  router.add("POST", "/api/events/:id/publish", async (req, _res, ctx) => {
    const event = await eventService.publishEvent(ctx.params.id, getUserId(req));
    ctx.sendJson(200, event);
  });

  // POST /api/events/:id/unpublish
  router.add("POST", "/api/events/:id/unpublish", async (req, _res, ctx) => {
    const event = await eventService.unpublishEvent(ctx.params.id, getUserId(req));
    ctx.sendJson(200, event);
  });

  // GET /api/events
  router.add("GET", "/api/events", async (_req, _res, ctx) => {
    const query = queryToObject(ctx.query);
    const events = await eventService.searchEvents(query);
    ctx.sendJson(200, { events });
  });

  // GET /api/events/:id
  router.add("GET", "/api/events/:id", async (_req, _res, ctx) => {
    const event = await eventService.getEvent(ctx.params.id);
    ctx.sendJson(200, event);
  });

  // POST /api/bookings
  router.add("POST", "/api/bookings", async (req, _res, ctx) => {
    const booking = await bookingService.bookTickets(ctx.body ?? {}, getUserId(req));
    ctx.sendJson(201, booking);
  });

  // GET /api/bookings/:reference
  router.add("GET", "/api/bookings/:reference", async (req, _res, ctx) => {
    const booking = await bookingService.getBooking(ctx.params.reference, getUserId(req));
    ctx.sendJson(200, booking);
  });

  // POST /api/bookings/:reference/pay
  router.add("POST", "/api/bookings/:reference/pay", async (req, _res, ctx) => {
    const booking = await bookingService.payBooking(
      ctx.params.reference,
      ctx.body ?? {},
      getUserId(req),
    );
    ctx.sendJson(200, booking);
  });

  // POST /api/bookings/:reference/cancel
  router.add("POST", "/api/bookings/:reference/cancel", async (req, _res, ctx) => {
    const booking = await bookingService.cancelBooking(ctx.params.reference, getUserId(req));
    ctx.sendJson(200, booking);
  });
}
