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
    holdExpiresAt: row.hold_expires_at ?? undefined,
    paidAt: row.paid_at ?? undefined,
    cancelledAt: row.cancelled_at ?? undefined,
    chargeId: row.charge_id ?? undefined,
    refundCents: row.refund_cents ?? undefined,
    refundedAt: row.refunded_at ?? undefined,
    refundId: row.refund_id ?? undefined,
  };
}

function rowToWaitlistEntry(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    tierId: row.tier_id,
    userId: row.user_id,
    quantity: row.quantity,
    status: row.status,
    createdAt: row.created_at,
    offerExpiresAt: row.offer_expires_at ?? undefined,
    expiredAt: row.expired_at ?? undefined,
    acceptedBookingId: row.accepted_booking_id ?? undefined,
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
  const listAllTiers = db.prepare("SELECT * FROM ticket_tiers ORDER BY rowid ASC");
  const updateTier = db.prepare(
    `UPDATE ticket_tiers
     SET event_id = ?, name = ?, price_cents = ?, capacity = ?, sold = ?
     WHERE id = ?`,
  );

  const insertBooking = db.prepare(
    `INSERT INTO bookings (
      id, reference, event_id, tier_id, user_id, quantity, amount_cents, status,
      created_at, hold_expires_at, paid_at, cancelled_at, charge_id,
      refund_cents, refunded_at, refund_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const getBookingByIdStmt = db.prepare("SELECT * FROM bookings WHERE id = ?");
  const getBookingByRefStmt = db.prepare("SELECT * FROM bookings WHERE reference = ?");
  const listBookingsStmt = db.prepare("SELECT * FROM bookings ORDER BY rowid ASC");
  const listBookingsByUserStmt = db.prepare(
    "SELECT * FROM bookings WHERE user_id = ? ORDER BY rowid ASC",
  );
  const listBookingsByStatusStmt = db.prepare(
    "SELECT * FROM bookings WHERE status = ? ORDER BY rowid ASC",
  );
  const updateBooking = db.prepare(
    `UPDATE bookings
     SET event_id = ?, tier_id = ?, user_id = ?, quantity = ?, amount_cents = ?, status = ?,
         created_at = ?, hold_expires_at = ?, paid_at = ?, cancelled_at = ?, charge_id = ?,
         refund_cents = ?, refunded_at = ?, refund_id = ?
     WHERE id = ?`,
  );
  const cancelBookingStmt = db.prepare(
    `UPDATE bookings
     SET status = ?, cancelled_at = ?, refund_cents = ?, refunded_at = ?, refund_id = ?
     WHERE id = ? AND status = ?`,
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

  const insertWaitlist = db.prepare(
    `INSERT INTO waitlist (
      id, tier_id, user_id, quantity, status, created_at,
      offer_expires_at, expired_at, accepted_booking_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const getWaitlistStmt = db.prepare("SELECT * FROM waitlist WHERE id = ?");
  const listWaitlistStmt = db.prepare("SELECT * FROM waitlist ORDER BY rowid ASC");
  const updateWaitlist = db.prepare(
    `UPDATE waitlist
     SET status = ?, offer_expires_at = ?, expired_at = ?, accepted_booking_id = ?
     WHERE id = ?`,
  );
  const casWaitlist = db.prepare(
    `UPDATE waitlist
     SET status = ?, offer_expires_at = ?, expired_at = ?, accepted_booking_id = ?
     WHERE id = ? AND status = ?`,
  );

  // node:sqlite has no db.transaction() helper; use explicit SQL transactions.
  function runInTransaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Build 8: status change AND seat release in one transaction. A second
   * canceller sees the changed status, changes zero rows and never releases. */
  const cancelWithRelease = ({ id, from, to, cancelledAt, refundCents, refundedAt, refundId }) =>
    runInTransaction(() => {
      const before = getBookingByIdStmt.get(id);
      if (!before) return null;
      // The caller supplies the status it read. If someone else changed it in
      // the meantime this updates zero rows and no seats are released.
      const result = cancelBookingStmt.run(
        to,
        cancelledAt,
        refundCents ?? null,
        refundedAt ?? null,
        refundId ?? null,
        id,
        from,
      );
      if (result.changes === 0) {
        return { conflict: true, booking: rowToBooking(before) };
      }
      const released = releaseSeatsStmt.run(before.quantity, before.tier_id, before.quantity);
      if (released.changes === 0) {
        fail("INVALID_STATE", "Could not release seats for this booking");
      }
      return { booking: rowToBooking(getBookingByIdStmt.get(id)) };
    });

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

    async listTiers() {
      return listAllTiers.all().map(rowToTier);
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
        createdAt: data.createdAt || new Date().toISOString(),
        holdExpiresAt: data.holdExpiresAt,
        refundCents: data.refundCents,
        refundedAt: data.refundedAt,
        refundId: data.refundId,
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
        booking.holdExpiresAt ?? null,
        booking.paidAt ?? null,
        booking.cancelledAt ?? null,
        booking.chargeId ?? null,
        booking.refundCents ?? null,
        booking.refundedAt ?? null,
        booking.refundId ?? null,
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
        booking.holdExpiresAt ?? null,
        booking.paidAt ?? null,
        booking.cancelledAt ?? null,
        booking.chargeId ?? null,
        booking.refundCents ?? null,
        booking.refundedAt ?? null,
        booking.refundId ?? null,
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

    async listBookingsByStatus(status) {
      return listBookingsByStatusStmt.all(status).map(rowToBooking);
    },

    /**
     * Atomically change a booking's status and release its seats once.
     * Returns { conflict: true } if another caller already changed the status.
     */
    async cancelBookingWithRelease(input) {
      return cancelWithRelease(input);
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

    // --- Build 8 waitlist -------------------------------------------------
    async createWaitlistEntry(data) {
      ensureUser.run(data.userId);
      const entry = {
        id: newId(),
        tierId: data.tierId,
        userId: data.userId,
        quantity: data.quantity ?? 1,
        status: data.status ?? "waiting",
        createdAt: data.createdAt || new Date().toISOString(),
        offerExpiresAt: data.offerExpiresAt,
      };
      insertWaitlist.run(
        entry.id,
        entry.tierId,
        entry.userId,
        entry.quantity,
        entry.status,
        entry.createdAt,
        entry.offerExpiresAt ?? null,
        entry.expiredAt ?? null,
        entry.acceptedBookingId ?? null,
      );
      return entry;
    },

    async getWaitlistEntryById(id) {
      return rowToWaitlistEntry(getWaitlistStmt.get(id));
    },

    async listWaitlistEntries(filters = {}) {
      const rows = listWaitlistStmt.all().map(rowToWaitlistEntry);
      return rows.filter((entry) => {
        if (filters.tierId !== undefined && entry.tierId !== filters.tierId) return false;
        if (filters.userId !== undefined && entry.userId !== filters.userId) return false;
        if (filters.status !== undefined && entry.status !== filters.status) return false;
        return true;
      });
    },

    async saveWaitlistEntry(entry) {
      updateWaitlist.run(
        entry.status,
        entry.offerExpiresAt ?? null,
        entry.expiredAt ?? null,
        entry.acceptedBookingId ?? null,
        entry.id,
      );
      return rowToWaitlistEntry(getWaitlistStmt.get(entry.id));
    },

    /** Compare-and-set so two callers cannot accept or expire the same offer. */
    async compareAndSetWaitlistStatus(id, from, to, patch = {}) {
      const result = casWaitlist.run(
        to,
        patch.offerExpiresAt ?? null,
        patch.expiredAt ?? null,
        patch.acceptedBookingId ?? null,
        id,
        from,
      );
      if (result.changes === 0) return null;
      return rowToWaitlistEntry(getWaitlistStmt.get(id));
    },
  };
}
