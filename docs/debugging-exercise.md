# Debugging exercise: exactly-once seat release

> **Note:** `docs/build-8.md` says the instructor supplies `docs/debugging-exercise.md`.
> No file was provided in this repository, so this is a self-contained write-up
> using two real defects found while building Build 8. It follows the same
> method: reproduce, observe, hypothesise, fix, verify, prevent.

## Bug 1: two cancellations could release the same seats twice

### 1. Symptom

`npm test` intermittently reported that a paid booking's tier had `sold = -1`
(or that a second booking stole the released seat) after two cancel requests
arrived at the same time. Sometimes the second request returned `200` instead
of `409`.

### 2. Reproduce

`test/cancellation.test.js` makes this deterministic:

```js
const [a, b] = await Promise.all([
  request(baseUrl, "POST", `/api/bookings/${reference}/cancel`, { token }),
  request(baseUrl, "POST", `/api/bookings/${reference}/cancel`, { token }),
]);
assert.deepEqual([a.res.status, b.res.status].sort(), [200, 409]);
assert.equal((await repo.getTierById(tierId)).sold, 0);
```

Expected: one winner (`200`), one loser (`409 INVALID_STATE`), seats released
once. Actual before the fix: both requests could read `status: "paid"`, both
call `refund()` and both run `sold = sold - 1`.

### 3. Observe / narrow

- Logged the booking status at three points: after `getBookingByReference`,
  after `assertTransition`, and inside `cancelBookingWithRelease`. Both calls
  saw `paid` at the first two points.
- Checked the refund gateway call count: it was 2, not 1.
- Checked the SQL: `UPDATE bookings SET status = ... WHERE id = ?` had no
  status predicate, so a second write could not detect that it was stale.
- The seat release happened in a separate step from the status write, so a
  crash or an interleaved request between them could also leave them out of
  sync.

### 4. Hypothesis

The check ("is this still paid?") and the action ("mark refunded and release
seats") were two separate operations. Another request could slip between them.
The fix must make the status change and seat release a single atomic,
conditional operation, and only the winner may call the gateway.

### 5. Fix

- `cancelBooking()` passes the status it read as `from` into the repository.
- `cancelBookingWithRelease()` runs inside `BEGIN IMMEDIATE` / `COMMIT` and
  executes `UPDATE bookings ... WHERE id = ? AND status = ?`. If `changes` is
  0 it returns `{ conflict: true }` and releases nothing.
- Only when the CAS succeeds does the service call `paymentGateway.refund()`.
- The loser gets `409 INVALID_STATE`.
- The same helper is used by `expireUnpaidBookings()`, so the scheduled job and
  a manual cancel cannot both release an expired hold's seats.

### 6. Verify

- `test/cancellation.test.js`: "two simultaneous cancels" -> `[200, 409]` and
  `sold = 0`; "cancelling twice" -> one `refund()` call, one release.
- `test/maintenance.test.js`: running the expiry job twice releases only once
  and leaves paid bookings untouched.
- Full suite: `npm test` -> 76 passing, 0 failing.

## Bug 2: accepting one waitlist offer created two bookings

### 1. Symptom

Two tabs of the same attendee could both accept the same offer. Both got a
`pending` booking, but `ticket_tiers.sold` only increased once, so one booking
had no real seat.

### 2. Reproduce

`test/waitlist.test.js`:

```js
const [a, b] = await Promise.all([
  request(baseUrl, "POST", `/api/waitlist/${offerId}/accept`, { token }),
  request(baseUrl, "POST", `/api/waitlist/${offerId}/accept`, { token }),
]);
assert.deepEqual([a.res.status, b.res.status].sort(), [200, 409]);
assert.equal(bookings.filter((booking) => booking.status !== "cancelled").length, 1);
```

### 3. Observe / narrow

The first version of `acceptOffer()` did:

1. read the entry, check `status === "offered"`;
2. call `createBookingFromOffer()`;
3. save the entry as `accepted`.

Steps 1 and 3 are a classic read-modify-write race. Both requests passed step 1
before either reached step 3. The seats were already held by the offer, so
neither request reserved new seats; the second booking was invisible in the
inventory count.

The same shape appeared in `expireOffer()`: the maintenance job could release
the offer's seats while an accept was in flight.

### 4. Hypothesis

An offer needs the same compare-and-set protection as a cancellation. The
claim must happen **before** the booking is created, and expiry must claim the
same status before it releases seats.

### 5. Fix

- Added a transient `accepting` status to the `waitlist` table.
- `acceptOffer()` calls `compareAndSetWaitlistStatus(id, "offered", "accepting")`
  first. A loser gets `409 INVALID_STATE` and creates no booking.
- `createBookingFromOffer()` allows `offered` or `accepting` and never reserves
  seats again (the offer already holds them).
- `expireOffer()` also claims `offered -> expired` by CAS before releasing
  seats. A late accept now sees `expired` and gets `409 OFFER_EXPIRED`, which
  matches the user story.
- If booking creation fails, the entry is restored to `offered`; the held
  seats were never given to another booking, so they are not released.

### 6. Verify

- `test/waitlist.test.js`: "two tabs accepting the same offer" -> one booking,
  `sold = 1`; "an expired offer passes to B" -> A gets `OFFER_EXPIRED`, B gets
  the offer, `sold` stays 1 through the hand-off.
- `test/maintenance.test.js`: "seats from an expired hold go to the next person"
  -> cancelled hold, offered entry, `sold = 1`.
- Browser check: A cancels a paid booking, B's My tickets page shows
  "Offer expires in 13:52" and Accept; accepting creates exactly one pending
  booking. No console errors.

## Bug 3 (tooling): `node:sqlite` has no `db.transaction()`

### Symptom and reproduction

The first SQLite implementation called `db.transaction(...)` and failed with
`TypeError: db.transaction is not a function` as soon as a cancellation test
started.

### Hypothesis and fix

That helper belongs to `better-sqlite3`, not Node's built-in `node:sqlite`.
I replaced it with explicit SQL around the critical section:

```js
db.exec("BEGIN IMMEDIATE");
try {
  const result = fn();
  db.exec("COMMIT");
  return result;
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
```

### Verification

`npm test` and `npm run oversell` both pass; the oversell demo still shows the
original bug (50 bookings for 1 seat) and the fixed version (1 success,
49 `SOLD_OUT`, `sold/cap = 1/1`).

## What this exercise demonstrates

- A second check is not a lock. Both requests can pass it before either writes.
- Process-local locks are not enough either: the guarantee belongs in the
  database, where all server instances share it.
- The unit of work must include every related write. Status change + seat
  release, or offer claim + booking creation, either all happen or none do.
- Use a controllable clock (`src/lib/clock.js`) for time-based rules so the
  boundary and expiry tests run in milliseconds instead of minutes or days.
- Write the concurrency test *before* believing the fix. The failing test is
  the evidence that the race existed and the passing test is the evidence that
  it is gone.
