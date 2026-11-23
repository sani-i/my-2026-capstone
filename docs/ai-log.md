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
- **What I asked:** Implement Build 4 from `docs/build-4.md`: in-memory repository (async events/tiers/bookings), event/booking services reusing domain rules, mock payment gateway, REST routes, update `docs/api-examples.md`, and API tests starting the real server on a free port.
- **What came back:** `src/repositories/memory.js`, `src/services/eventService.js`, `src/services/bookingService.js`, `src/lib/mockPaymentGateway.js`, `src/http/routes.js`, wired `src/server.js` and `src/http/app.js` (error-code-to-status map, route registration, uniform error shape), updated `docs/api-examples.md`, and added `test/api.test.js`.
- **What was wrong (or "nothing"):** Initial route handlers called `sendJson(status, body)` using the app helper signature `(res, status, body)`, causing 500 `ERR_INVALID_ARG_TYPE`; fixed by using `ctx.sendJson(status, body)`. I kept error mapping in `app.js` so DomainError codes map to the documented HTTP statuses (400/401/402/403/404/409). Known gap left on purpose: in-memory booking is not atomic across concurrent requests (Build 5).
- **Rules I was unsure about:** `venue` treated as required (matches S02). Paying/viewing/cancelling another user's booking returns 403 `FORBIDDEN`. Added `POST /api/events/:id/unpublish`, `GET /api/events/:id`, and `GET /api/bookings/:reference` to support the documented API examples.

## Build 5

### Prompt 1: move to SQLite and reproduce the problem (docs/build-5.md)
- **What I asked:** Implement Build 5 from `docs/build-5.md`: `src/db/schema.sql` and `src/db/connection.js` on `node:sqlite`, SQLite repo with same methods as memory repo, `scripts/seed.js`, `scripts/oversell-demo.js` (50 concurrent bookings for 1 last seat), `seed`/`oversell` scripts.
- **What came back:** Schema with users/events/ticket_tiers/bookings, PK/FK/UNIQUE/CHECK constraints including `CHECK (sold >= 0 AND sold <= capacity)`; `node:sqlite` `DatabaseSync` connection with `PRAGMA foreign_keys = ON`; `src/repositories/sqlite.js` using prepared `?` statements; memory repo given matching `reserveSeats`/`releaseSeats`; server wired to SQLite (`DATABASE_PATH`, default `data/ticketing.db`) so data survives restart; seed and oversell scripts.
- **What was wrong (or "nothing"):** With `DatabaseSync` calls are synchronous, so a naive Promise.all race doesn't naturally interleave. I simulated the lost-update by taking 50 stale reads then writing all 50; writing `sold = sold + 1` hit the CHECK constraint, so I used the stale-computed `sold = row.sold + 1` write to show the real bug: `sold/cap` looked right (1/1) while 50 bookings were inserted. SQLite ignores FKs unless `PRAGMA foreign_keys = ON` is set per connection; I set it in connection. No signup yet, so repo inserts bare user rows with `INSERT OR IGNORE` before FK-dependent inserts.

### Prompt 2: fix it
- **What I asked:** Fix overselling in the database with one atomic `UPDATE ticket_tiers SET sold = sold + ? WHERE id = ? AND sold + ? <= capacity`, use changed-row count, throw `SOLD_OUT` on no change; add `reserveSeats`/`releaseSeats` to both repos; update bookingService book/cancel; add `test/oversell.test.js` (50 simultaneous for 1 seat => 1 success, 49 SOLD_OUT); show before/after demo.
- **What came back:** `reserveSeats`/`releaseSeats` in sqlite and memory repos; `bookingService.bookTickets` uses atomic `reserveSeats` and releases on booking-create failure; `cancelBooking` uses `releaseSeats`; oversell test passes; demo shows before 50/0/1/1/50 bookings vs after 1/49/1/1/1 booking.
- **Why a lock variable or a second check does not work:** A second check still reads stale state because another request can read before any write commits; checking twice narrows but does not eliminate the race. A lock variable is process-local, so another process or server instance bypasses it, and a crash/exception before unlock can block all future bookings.
- **What was wrong (or "nothing"):** Added a `releaseSeats` best-effort catch when booking creation fails after reserving seats. Known gap for Build 8: concurrent cancel/refund flows must release seats exactly once.

## Build 6

### Prompt 1: Build 6 prompt (docs/build-6.md)
- **What I asked:** Implement Build 6 frontend in plain HTML/CSS/JS ES modules (no framework/build step): browse/search/filter/sort events, event detail with tiers and quantity picker, checkout with countdown and mock card payment, mock data/API layer matching real API shape, `el()` DOM helper with no innerHTML for data.
- **What came back:** `public/index.html`, `public/event.html`, `public/css/styles.css`, `public/js/ui.js` (`el`, `clear`, `formatCents`), `public/js/mockData.js`, `public/js/api.js` (`listEvents`, `getEvent`, `createBooking`, `pay`), `public/js/pages/home.js`, `public/js/pages/event.js`. Mock bookings include 10-minute hold and `tok_success`/`tok_declined` handling.
- **What was wrong (or "nothing"):** The mock `api.js` keeps state in module memory only (resets on page reload), which is acceptable for Build 6 mock-data scope. Countdown expiry disables pay and asks user to book again; declined card shows error and allows retry. I kept all data access behind `api.js` and used `textContent`/DOM nodes (no innerHTML for data).

## Build 7

### Prompt 1: Build 7 prompt (docs/build-7.md)
- **What I asked:** Implement Build 7 from `docs/build-7.md`: scrypt password hashing with random salt, HS256 signed tokens from an env secret, `authService` + `src/routes/auth.js` with signup/login/me, `requireUser`/`requireRole` guards replacing `x-user-id` everywhere, private bookings and organizer-owned events, a `fetch`-based `api.js` with Bearer tokens plus `session.js`, `login.html`, `tickets.html`, `organizer.html`, and tests for signup/login/bad token/expired token/wrong role/one attendee reading another's booking.
- **What came back (first pass):** `src/lib/password.js`, `src/lib/token.js`, `src/http/guards.js`, `src/services/authService.js`, user methods in both repositories and the SQLite schema, and the two new error codes in `app.js`. The rest of the build was still missing, so I finished it: `src/routes/auth.js`, Bearer-token refactor of `src/http/routes.js`, `bookingService`/`eventService` taking an authenticated `{ id, role }` user instead of a header string, `listMyBookings`/`listMyEvents`, `src/server.js` wiring, the four frontend files + three page modules, and 7 new tests.
- **What was wrong (or "nothing"):**
  1. **The prompt contradicts the user story.** The AI prompt says another person's booking gives `NOT_FOUND`; story S13 explicitly says `FORBIDDEN`, and the existing Build 4 test expects `403 FORBIDDEN`. I followed S13 and the tests and used `FORBIDDEN` for view/pay/cancel; I left a comment in `bookingService.js` explaining why. This is the rule I was least sure about.
  2. **`AUTH_SECRET` would break `npm start`.** The first token code threw whenever the variable was missing. To keep local dev and the browser demo working, the secret now falls back to a fixed development value unless `NODE_ENV=production` (or a too-short secret is explicitly set), in which case it throws. Production must set a real secret; documented in `docs/api-examples.md`.
  3. **`authService` used `crypto.randomUUID` without importing it** in the first pass; switched to an explicit `import { randomUUID } from "node:crypto"`.
  4. **`getBearerToken` used `header.split(" ")`**, so `Bearer   token` parsed as an empty token. Replaced with a case-insensitive regex.
  5. **The nav never appeared in the browser.** `public/js/nav.js` defined `mountNav()` but never called it; the browser check caught the empty `#nav-auth` slot. Added the call and re-verified all pages.
  6. **The real API has no `holdExpiresAt`.** Build 6's countdown relied on the mock field. `event.js` now derives a 10-minute display window from `booking.createdAt`; there is no server-side hold expiry yet (Build 8 territory), so I did not pretend there is one.
  7. **`GET /api/events/mine` had to be registered before `GET /api/events/:id`**, otherwise the router captures "mine" as an event id. Added a comment at the registration site.
- **Checks I ran:** `npm test` = 53/53 passing (including 7 new auth tests). Browser end-to-end in a real tab: signed up an organizer, created an event, added a tier, published it; signed up an attendee in a second session, found the event in search, booked, got `PAYMENT_DECLINED` on `tok_declined` and could retry, paid with `tok_success`, saw the booking in My tickets, and confirmed an attendee cannot open the organizer dashboard. No console errors. `public/js/mockData.js` was deleted; `docs/api-examples.md` rewritten for Bearer tokens.
- **Known gaps for Build 8:** there is no real seat-hold expiry, and refund/cancel concurrency still needs to release seats exactly once.
