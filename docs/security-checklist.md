# Security checklist (Build 9)

Quick checklist of what the app protects and how. This is a course project, not a
production security audit, but each item has an implementation and a test.

## Secrets and tokens

- [x] Login tokens and QR ticket codes use **different secrets** (`AUTH_SECRET`,
  `TICKET_SECRET`). See `src/lib/token.js` and `src/lib/ticketToken.js`.
- [x] Production (`NODE_ENV=production`) refuses to start with a missing or short
  secret. Development has a clearly labelled fallback so the demo works offline.
- [x] No secret value is committed. `.env` is ignored; `.env.example` has placeholders only.
- [x] Passwords are hashed with a random salt using `node:crypto.scrypt` and never returned.

## QR tickets

- [x] The signed payload contains only `{ ref, iat }` — a booking reference and an
  issued-at time. No name, email, phone number or price is in the QR code.
- [x] HMAC-SHA256 signature is compared with `timingSafeEqual` so an attacker cannot
  learn the key one byte at a time.
- [x] Extra payload keys, malformed base64url, bad signatures and made-up codes all
  fail with `INVALID_TICKET`.
- [x] A cancelled/refunded booking's code is rejected even though its signature is valid.

## Check-in and concurrency

- [x] `POST /api/checkin` requires an authenticated **staff** user. A valid JWT for an
  attendee gets `403 FORBIDDEN`.
- [x] Check-in is one conditional `UPDATE ... WHERE id = ? AND status = 'paid'`. The
  timestamp is written in the same statement, so two simultaneous scans cannot both win.
- [x] The loser gets `DUPLICATE_CHECKIN` with the winner's `checkedInAt` time.
- [x] A ticket for another event is rejected with `WRONG_EVENT` when the door's event is supplied.

## HTTP hardening

- [x] `Content-Security-Policy` allows only same-origin scripts/styles and has no
  `unsafe-inline`. All page JavaScript is external ES modules.
- [x] `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and
  `X-Frame-Options: DENY` are applied to every response, including static files.
- [x] Static file paths are resolved inside `public/`; path escape returns `403`.
- [x] Login and check-in have separate per-IP sliding-window rate limits with
  `429 RATE_LIMITED` and a `Retry-After` header.

## Data access and automation

- [x] Authored requests take identity from the verified token, never a request header.
- [x] Users can read only their own bookings and tickets; organizers can edit only their events.
- [x] `npm test` runs on every push and pull request through `.github/workflows/ci.yml`.
- [x] No user data is sent to a third party; the QR encoder is vendored in `public/js/qr.js`.

## Known limits

- The rate limiter is in-process, so it is per server instance; a multi-instance
  deployment would need a shared store such as Redis.
- Scanning uses a pasted code in the demo UI. A physical scanner that types the code
  works the same way; camera decoding is not implemented.
