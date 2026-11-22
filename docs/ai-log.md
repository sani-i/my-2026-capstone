# AI log

Every time you give an AI tool a significant prompt, add an entry. Three lines each.
"Nothing was wrong" is allowed, but it is rarely true. Your instructor will read this.

## Build 1

### Prompt 1: Build 1 prompt (docs/build-1.md)
- **What I asked:** Implement the Build 1 domain core from `docs/build-1.md`: `package.json` (ES module), `src/domain/errors.js`, `src/domain/ids.js`, `src/domain/waitlistQueue.js`, `src/domain/inventory.js`, `scripts/demo.js`, `scripts/benchmark-lookup.js`, with demo/benchmark npm scripts.
- **What came back:** All requested files were created with a `DomainError` (`code` + message), crypto-based `newId()`/`newReference()`, a linked-list FIFO `Queue` with O(1) `enqueue`/`dequeue`/`peek`/`size`, an in-memory store with event/tier/booking/waitlist Maps, booking validation (1-10 tickets, whole-cent amounts, SOLD_OUT with no state change), O(1) booking lookup by reference, cancellation that releases seats and rejects double-cancel, plus demo and benchmark scripts.
- **What was wrong (or "nothing"):** No runtime errors after running both scripts. I made explicit API choices the prompt left open: `cancelBooking(store, bookingId)` takes a booking id; `joinWaitlist` stores `{id, tierId, userName, joinedAt}` entries and the waitlist queue is exposed on `store.waitlistsByTier` so the demo can name the next person in line; `createEvent` accepts optional `city/venue/startsAt` for readability. These should be reviewed against future build expectations.

## Build 2

### Prompt 1: Build 2 prompt (docs/build-2.md)
- **What I asked:** Implement Build 2 from `docs/build-2.md`: stable `mergeSort` (no `Array.prototype.sort`, no mutation), `publishEvent`/`unpublishEvent`/`listEventSummaries` in inventory, pure `filterEvents`/`sortEvents`/`searchEvents` in `eventSearch.js`, node:test coverage for S02/S03/S04/S05/S06 and required cases, and add `npm test`.
- **What came back:** Added `src/domain/sorting.js`, `src/domain/eventSearch.js`, updated `src/domain/inventory.js` (draft/published status, stricter S02 validation, publish/unpublish, event summaries, pending bookings per S06), added tests in `test/sorting.test.js`, `test/inventory.test.js`, `test/eventSearch.test.js`, and `npm test` script.
- **What was wrong (or "nothing"):** One test I wrote initially misread S05 AC4 (I used different times on the same day but expected title tie order); the implementation was correct, I fixed the test to use same timestamps for the same-day tie case. I also drafted S04 acceptance criteria in `docs/build-2.md` because they were left for the class to write; they should be reviewed. `createEvent` now requires `title`, `city`, `venue`, and a valid `startsAt` date, and bookings are created as `pending` per S06.

## Build 3

### Prompt 1: Build 3 prompt (docs/build-3.md)
- **What I asked:** Implement Build 3 from `docs/build-3.md`: confirm `docs/architecture.md` diagrams, add booking state machine, tiny HTTP router/server on `node:http`, `/health`, static serving from `public/` with path-escape protection, JSON error shape, config/start scripts, and tests for all allowed/illegal transitions, router, and real HTTP `/health`.
- **What came back:** Added `src/domain/bookingStateMachine.js` (`BOOKING_STATES`, `canTransition`, `assertTransition`, `getAllowedTransitions`, `INVALID_TRANSITION`), `src/http/router.js` (method+path with `:params`), `src/http/app.js` (node:http server, `/health`, JSON 404 for unknown `/api/*`, BAD_JSON 400, uniform error shape, safe static serving from `public/`), `src/config.js`, `src/server.js`, `public/index.html`, and tests in `test/bookingStateMachine.test.js`, `test/router.test.js`, `test/http.test.js`. Added `"start": "node src/server.js"`.
- **What was wrong (or "nothing"):** `docs/architecture.md` already satisfied the requested diagrams/layer sentences; I kept it. I made JSON body parsing run before route matching for non-GET/HEAD JSON requests so bad JSON returns 400 even on unknown routes; this matches the prompt's "Bad JSON returns a JSON 400" rule. Static path escape is guarded by resolving against `publicDir` and rejecting paths outside it.

## Build 4

### Prompt 1: Build 4 prompt (docs/build-4.md)
- **What I asked:** The Build 4 prompt: an in-memory repository, event and booking services, a mock payment gateway, the API routes, `docs/api-examples.md` and API tests that start the real server.
- **What came back:** `src/repositories/memory.js`, `src/services/eventService.js`, `src/services/bookingService.js`, `src/lib/mockPaymentGateway.js`, `src/http/routes.js`, wiring in `src/server.js`, an error-code-to-status map in `src/http/app.js`, `docs/api-examples.md` and `test/api.test.js`.
- **What was wrong (or "nothing"):** In the Build 3 code, every DomainError came back as 400, so `SOLD_OUT` and `NOT_FOUND` would have had the wrong status; added one code-to-status map in `app.js`. The validation helpers lived privately inside `inventory.js`, so reusing them meant moving them to `src/domain/validation.js` rather than copying. Known gap left on purpose: two bookings at the same moment can both take the last seat (Build 5). *(My own review: add what you find when you read the code.)*
- **Rules I was unsure about:** whether `venue` is required (kept optional, as in Build 2); whether a stranger paying someone else's booking should get 403 or 404 (chose 403 `FORBIDDEN`); added `unpublish`, `GET /api/events/:id` and `GET /api/bookings/:reference`, which the prompt did not list but S04 and the curl examples need.

## Build 5

### Prompt 1: move to SQLite and reproduce the problem (docs/build-5.md)
- **What I asked:** `src/db/schema.sql` and `src/db/connection.js` on `node:sqlite`, a SQLite repository with the same methods as `memory.js`, `scripts/seed.js`, and `scripts/oversell-demo.js` firing 50 bookings at the last seat with `Promise.all`.
- **What came back:** The schema (users, events, ticket_tiers, bookings with PRIMARY KEY, FOREIGN KEY, UNIQUE and CHECK, including `CHECK (sold >= 0 AND sold <= capacity)`), `src/repositories/sqlite.js` with prepared `?` statements, the seed and oversell scripts, and `seed`/`oversell` in `package.json`.
- **What was wrong (or "nothing"):** The CHECK on `sold` did **not** catch the bug: every racing request saved `sold = 9 + 1 = 10`, so the column looked right while 50 bookings existed for 1 seat (a lost update). The demo had to count rows in `bookings`, not just read `sold`. SQLite also ignores FOREIGN KEY unless `PRAGMA foreign_keys = ON` is set on every connection. There is no signup yet, so bookings would fail their FOREIGN KEY on `users`; the repository inserts a bare user row the first time an id is seen (`INSERT OR IGNORE`).
- **Rules I was unsure about:** whether `users` should exist before Build 7 (kept it, with name, email and role empty for now).

### Prompt 2: fix it
- **What I asked:** Reserve seats with one atomic UPDATE and use the changed-row count; add `test/oversell.test.js`; show the demo before and after.
- **What came back:** `reserveSeats` and `releaseSeats` in both repositories, `bookingService.book` using `reserveSeats` instead of read-check-write, `cancel` using `releaseSeats`, and the oversell test. Demo before: 50 succeeded, 59 bookings for 10 seats. After: 1 succeeded, 49 `SOLD_OUT`, 10 bookings for 10 seats.
- **Why a lock variable or a second check does not work:** A second check reads the same stale number, because every request can read before any of them writes; checking twice only makes the gap smaller, not gone. A lock variable lives in one Node process, so a second server process (or a script writing to the same database) never sees it, and a forgotten unlock after an error blocks every later booking.
- **What was wrong (or "nothing"):** If saving the booking failed after the seat was taken, the seat stayed taken forever; added a `releaseSeats` in a `catch`. I checked that the test fails without the fix by putting the Build 4 lines back: all 4 oversell tests failed, then passed again with the fix. Known gap for Build 8: two cancel requests at the same moment could both pass the status check (refunds must release seats exactly once).

