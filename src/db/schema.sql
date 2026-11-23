PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  password_hash TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email <> '';

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  organizer_id TEXT NOT NULL,
  title TEXT NOT NULL,
  city TEXT NOT NULL,
  venue TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  FOREIGN KEY (organizer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ticket_tiers (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  sold INTEGER NOT NULL DEFAULT 0 CHECK (sold >= 0 AND sold <= capacity),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL,
  tier_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 10),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded', 'checked_in')),
  created_at TEXT NOT NULL,
  hold_expires_at TEXT,
  paid_at TEXT,
  cancelled_at TEXT,
  charge_id TEXT,
  refund_cents INTEGER,
  refunded_at TEXT,
  refund_id TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (tier_id) REFERENCES ticket_tiers(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_tiers_event_id ON ticket_tiers(event_id);
CREATE INDEX IF NOT EXISTS idx_bookings_reference ON bookings(reference);
CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_tier_id ON bookings(tier_id);
CREATE INDEX IF NOT EXISTS idx_bookings_expiry ON bookings(status, hold_expires_at);

-- Build 8: first-in-first-out waitlist. "rowid" after created_at keeps the
-- order stable when two people join at the same clock instant.
CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  tier_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1 AND quantity <= 10),
  status TEXT NOT NULL CHECK (status IN ('waiting', 'offered', 'accepting', 'accepted', 'expired', 'cancelled')),
  created_at TEXT NOT NULL,
  offer_expires_at TEXT,
  expired_at TEXT,
  accepted_booking_id TEXT,
  FOREIGN KEY (tier_id) REFERENCES ticket_tiers(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_waitlist_tier_status ON waitlist(tier_id, status);
CREATE INDEX IF NOT EXISTS idx_waitlist_user ON waitlist(user_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_offer_expiry ON waitlist(status, offer_expires_at);
