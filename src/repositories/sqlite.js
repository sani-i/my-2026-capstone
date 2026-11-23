import { newId, newReference } from "../domain/ids.js";
import { fail } from "../domain/errors.js";

function rowToEvent(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    organizerId: row.organizer_id,
    title: row.title,
    city: row.city,
    venue: row.venue,
    startsAt: row.starts_at,
    status: row.status,
    tierIds: [], // filled by caller when needed
  };
}

function rowToTier(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    priceCents: row.price_cents,
    capacity: row.capacity,
    sold: row.sold,
  };
}

function rowToBooking(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    reference: row.reference,
    eventId: row.event_id,
    tierId: row.tier_id,
    userId: row.user_id,
    quantity: row.quantity,
    amountCents: row.amount_cents,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    chargeId: row.charge_id ?? undefined,
  };
}

export function createSqliteRepository(db) {
  const ensureUser = db.prepare(
    "INSERT OR IGNORE INTO users (id, name, email, role) VALUES (?, '', '', '')",
  );
  const insertAuthUser = db.prepare(
    "INSERT INTO users (id, name, email, role, password_hash) VALUES (?, ?, ?, ?, ?)",
  );
  const getUserByEmailStmt = db.prepare("SELECT * FROM users WHERE email = ?");
  const getUserByIdStmt = db.prepare("SELECT * FROM users WHERE id = ?");

  function rowToUser(row) {
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name || "",
      email: row.email,
      role: row.role,
      passwordHash: row.password_hash ?? "",
    };
  }

  const insertEvent = db.prepare(
    `INSERT INTO events (id, organizer_id, title, city, venue, starts_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const getEvent = db.prepare("SELECT * FROM events WHERE id = ?");
  const listEventsStmt = db.prepare("SELECT * FROM events ORDER BY rowid ASC");
  const listEventsByOrganizerStmt = db.prepare(
    "SELECT * FROM events WHERE organizer_id = ? ORDER BY rowid ASC",
  );
  const updateEvent = db.prepare(
    `UPDATE events
     SET organizer_id = ?, title = ?, city = ?, venue = ?, starts_at = ?, status = ?
     WHERE id = ?`,
  );
  const listTierIdsByEvent = db.prepare("SELECT id FROM ticket_tiers WHERE event_id = ? ORDER BY rowid ASC");

  const insertTier = db.prepare(
    `INSERT INTO ticket_tiers (id, event_id, name, price_cents, capacity, sold)
     VALUES (?, ?, ?, ?, ?, 0)`,
  );
  const getTier = db.prepare("SELECT * FROM ticket_tiers WHERE id = ?");
  const listTiersByEvent = db.prepare("SELECT * FROM ticket_tiers WHERE event_id = ? ORDER BY rowid ASC");
  const updateTier = db.prepare(
    `UPDATE ticket_tiers
     SET event_id = ?, name = ?, price_cents = ?, capacity = ?, sold = ?
     WHERE id = ?`,
  );

  const insertBooking = db.prepare(
    `INSERT INTO bookings (
      id, reference, event_id, tier_id, user_id, quantity, amount_cents, status, created_at, paid_at, cancelled_at, charge_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const getBookingByIdStmt = db.prepare("SELECT * FROM bookings WHERE id = ?");
  const getBookingByRefStmt = db.prepare("SELECT * FROM bookings WHERE reference = ?");
  const listBookingsStmt = db.prepare("SELECT * FROM bookings ORDER BY rowid ASC");
  const listBookingsByUserStmt = db.prepare(
    "SELECT * FROM bookings WHERE user_id = ? ORDER BY rowid ASC",
  );
  const updateBooking = db.prepare(
    `UPDATE bookings
     SET event_id = ?, tier_id = ?, user_id = ?, quantity = ?, amount_cents = ?, status = ?,
         created_at = ?, paid_at = ?, cancelled_at = ?, charge_id = ?
     WHERE id = ?`,
  );

  const reserveSeatsStmt = db.prepare(
    `UPDATE ticket_tiers
     SET sold = sold + ?
     WHERE id = ? AND sold + ? <= capacity`,
  );
  const releaseSeatsStmt = db.prepare(
    `UPDATE ticket_tiers
     SET sold = sold - ?
     WHERE id = ? AND sold - ? >= 0`,
  );

  function hydrateEvent(row) {
    const event = rowToEvent(row);
    if (!event) return undefined;
    event.tierIds = listTierIdsByEvent.all(event.id).map((r) => r.id);
    return event;
  }

  return {
    async createUser(data) {
      try {
        insertAuthUser.run(data.id, data.name || "", data.email, data.role, data.passwordHash);
      } catch (err) {
        if (String(err?.message || "").includes("UNIQUE")) {
          fail("EMAIL_TAKEN", "Email is already registered");
        }
        throw err;
      }
      return rowToUser(getUserByIdStmt.get(data.id));
    },

    async getUserByEmail(email) {
      return rowToUser(getUserByEmailStmt.get(email));
    },

    async getUserById(id) {
      return rowToUser(getUserByIdStmt.get(id));
    },

    async createEvent(data) {
      ensureUser.run(data.organizerId);
      const event = {
        id: newId(),
        organizerId: data.organizerId,
        title: data.title,
        city: data.city,
        venue: data.venue,
        startsAt: data.startsAt,
        status: "draft",
        tierIds: [],
      };
      insertEvent.run(
        event.id,
        event.organizerId,
        event.title,
        event.city,
        event.venue,
        event.startsAt,
        event.status,
      );
      return event;
    },

    async getEventById(id) {
      return hydrateEvent(getEvent.get(id));
    },

    async saveEvent(event) {
      ensureUser.run(event.organizerId);
      updateEvent.run(
        event.organizerId,
        event.title,
        event.city,
        event.venue,
        event.startsAt,
        event.status,
        event.id,
      );
      return hydrateEvent(getEvent.get(event.id));
    },

    async listEvents() {
      return listEventsStmt.all().map(hydrateEvent);
    },

    async listEventsByOrganizerId(organizerId) {
      return listEventsByOrganizerStmt.all(organizerId).map(hydrateEvent);
    },

    async createTier(data) {
      const tier = {
        id: newId(),
        eventId: data.eventId,
        name: data.name,
        priceCents: data.priceCents,
        capacity: data.capacity,
        sold: 0,
      };
      insertTier.run(tier.id, tier.eventId, tier.name, tier.priceCents, tier.capacity);
      return tier;
    },

    async getTierById(id) {
      return rowToTier(getTier.get(id));
    },

    async saveTier(tier) {
      updateTier.run(tier.eventId, tier.name, tier.priceCents, tier.capacity, tier.sold, tier.id);
      return rowToTier(getTier.get(tier.id));
    },

    async listTiersByEventId(eventId) {
      return listTiersByEvent.all(eventId).map(rowToTier);
    },

    async createBooking(data) {
      ensureUser.run(data.userId);
      const booking = {
        id: newId(),
        reference: newReference(),
        eventId: data.eventId,
        tierId: data.tierId,
        userId: data.userId,
        quantity: data.quantity,
        amountCents: data.amountCents,
        status: data.status ?? "pending",
        createdAt: new Date().toISOString(),
      };
      insertBooking.run(
        booking.id,
        booking.reference,
        booking.eventId,
        booking.tierId,
        booking.userId,
        booking.quantity,
        booking.amountCents,
        booking.status,
        booking.createdAt,
        booking.paidAt ?? null,
        booking.cancelledAt ?? null,
        booking.chargeId ?? null,
      );
      return booking;
    },

    async getBookingById(id) {
      return rowToBooking(getBookingByIdStmt.get(id));
    },

    async getBookingByReference(reference) {
      return rowToBooking(getBookingByRefStmt.get(reference));
    },

    async saveBooking(booking) {
      ensureUser.run(booking.userId);
      updateBooking.run(
        booking.eventId,
        booking.tierId,
        booking.userId,
        booking.quantity,
        booking.amountCents,
        booking.status,
        booking.createdAt,
        booking.paidAt ?? null,
        booking.cancelledAt ?? null,
        booking.chargeId ?? null,
        booking.id,
      );
      return rowToBooking(getBookingByIdStmt.get(booking.id));
    },

    async listBookings() {
      return listBookingsStmt.all().map(rowToBooking);
    },

    async listBookingsByUserId(userId) {
      return listBookingsByUserStmt.all(userId).map(rowToBooking);
    },

    /**
     * Atomically reserve seats. If no row changed, throw SOLD_OUT.
     */
    async reserveSeats(tierId, quantity) {
      const result = reserveSeatsStmt.run(quantity, tierId, quantity);
      if (result.changes === 0) {
        const tier = rowToTier(getTier.get(tierId));
        if (!tier) fail("NOT_FOUND", `tier not found: ${tierId}`);
        const remaining = Math.max(0, tier.capacity - tier.sold);
        fail("SOLD_OUT", `Only ${remaining} ticket(s) left in ${tier.name}`);
      }
      return rowToTier(getTier.get(tierId));
    },

    /**
     * Atomically release seats (used for cancellations).
     */
    async releaseSeats(tierId, quantity) {
      const result = releaseSeatsStmt.run(quantity, tierId, quantity);
      if (result.changes === 0) {
        const tier = rowToTier(getTier.get(tierId));
        if (!tier) fail("NOT_FOUND", `tier not found: ${tierId}`);
        return tier;
      }
      return rowToTier(getTier.get(tierId));
    },
  };
}
