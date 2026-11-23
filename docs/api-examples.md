# API examples (Build 7)

Every call the API supports, with `curl`, in the order you would use them:
sign up, log in, create, publish, book, pay. Start the server first:

```bash
AUTH_SECRET=a-long-random-secret-at-least-16-chars npm start
```

`AUTH_SECRET` is required when `NODE_ENV=production`. For local development a
fixed development secret is used if the variable is missing (the server prints
a warning). Data is stored in SQLite at `data/ticketing.db` and survives a
restart; set `DATABASE_PATH` to use a different file.

Login gives you a signed token. Put it in the `Authorization: Bearer` header on
every protected call. The server reads identity **and role** from that token;
`x-user-id` no longer works. Ids and booking references are new for every event
and booking, so copy them from each response into the variables below.

## Errors

Every error has the same shape:

```json
{ "error": { "code": "SOLD_OUT", "message": "Only 1 ticket(s) left in General" } }
```

| Code | Status | When |
|---|---|---|
| `VALIDATION`, `BAD_JSON` | 400 | The input is missing or wrong or JSON is invalid |
| `UNAUTHENTICATED` | 401 | Missing, edited or expired bearer token |
| `INVALID_CREDENTIALS` | 401 | Wrong password or unknown email (same message for both) |
| `PAYMENT_DECLINED` | 402 | The mock card was declined. The booking stays pending |
| `FORBIDDEN` | 403 | Wrong role, or not your event/booking |
| `NOT_FOUND` | 404 | No such event, tier, booking or route |
| `EMAIL_TAKEN` | 409 | Email is already registered |
| `SOLD_OUT`, `INVALID_STATE`, `INVALID_TRANSITION` | 409 | The request clashes with the current state |

## 1. Sign up (anyone)

`password` must be at least 8 characters; `role` is `attendee` (the default),
`organizer` or `staff`. The response never contains the password or its hash.

```bash
curl -s -X POST http://localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com","password":"password123","role":"organizer"}'
```

`201` with a token and the public user. Copy the token:

```bash
ORG_TOKEN=paste-the-organizer-token-here
```

Sign up an attendee the same way (use `"role":"attendee"` or leave role out):

```bash
curl -s -X POST http://localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"bayo@example.com","password":"password123","role":"attendee"}'
```

```bash
ATTENDEE_TOKEN=paste-the-attendee-token-here
```

## 2. Log in and check who you are

```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"password123"}'
```

```bash
curl -s http://localhost:3000/api/auth/me -H "Authorization: Bearer $ORG_TOKEN"
```

A wrong password and an unknown email both give `401 INVALID_CREDENTIALS` with
the same message. A missing, edited or expired token gives `401 UNAUTHENTICATED`.

## 3. Create an event (organizer)

```bash
curl -s -X POST http://localhost:3000/api/events \
  -H 'content-type: application/json' -H "Authorization: Bearer $ORG_TOKEN" \
  -d '{"title":"Lagos Tech Meetup","city":"Lagos","venue":"Landmark Centre","startsAt":"2026-12-05T17:00:00Z"}'
```

`201` with the new draft event. An attendee token here gets `403 FORBIDDEN`.
Copy the id:

```bash
EVENT_ID=paste-the-id-here
```

## 4. Add a ticket tier (organizer)

`priceCents` is whole cents (or kobo): 500000 is 5,000.00.

```bash
curl -s -X POST http://localhost:3000/api/events/$EVENT_ID/tiers \
  -H 'content-type: application/json' -H "Authorization: Bearer $ORG_TOKEN" \
  -d '{"name":"General","priceCents":500000,"capacity":100}'
```

`201` with the tier, `sold: 0` and `seatsLeft: 100`. Copy its id:

```bash
TIER_ID=paste-the-id-here
```

## 5. Publish the event (organizer)

```bash
curl -s -X POST http://localhost:3000/api/events/$EVENT_ID/publish \
  -H "Authorization: Bearer $ORG_TOKEN"
```

`200` with `"status":"published"`. An event with no tiers gets `409 INVALID_STATE`.
Another organizer editing this event gets `403 FORBIDDEN`.

List your own events (including drafts):

```bash
curl -s http://localhost:3000/api/events/mine -H "Authorization: Bearer $ORG_TOKEN"
```

## 6. Search published events (no token needed)

All query parameters are optional: `q` (title or venue), `city`, `from`, `to`
(a date-only `to` includes the whole day), `maxPriceCents`, `onlyAvailable=true`,
and `sort` = `date` (default), `price` or `availability`.

```bash
curl -s 'http://localhost:3000/api/events?city=lagos&maxPriceCents=600000&sort=price'
```

`200` with `{"events":[...]}`. Drafts are never listed.

## 7. View one event (no token needed)

```bash
curl -s http://localhost:3000/api/events/$EVENT_ID
```

`200` with the event and its tiers, including `seatsLeft` for each.

## 8. Book tickets (attendee)

```bash
curl -s -X POST http://localhost:3000/api/bookings \
  -H 'content-type: application/json' -H "Authorization: Bearer $ATTENDEE_TOKEN" \
  -d "{\"tierId\":\"$TIER_ID\",\"quantity\":2}"
```

`201` with a `pending` booking, its `amountCents` and its `reference`:

```bash
REF=paste-the-reference-here
```

## 9. View your bookings (only your own)

```bash
curl -s http://localhost:3000/api/bookings -H "Authorization: Bearer $ATTENDEE_TOKEN"
curl -s http://localhost:3000/api/bookings/$REF -H "Authorization: Bearer $ATTENDEE_TOKEN"
```

A different attendee reading `$REF` gets `403 FORBIDDEN`, and the list only ever
contains bookings owned by the token holder.

## 10. Pay for a booking (the attendee who made it)

The mock gateway never sees a card number. It takes a payment token instead:
`tok_success` pays, `tok_declined` is declined.

A declined card (`402 PAYMENT_DECLINED`, the booking stays pending):

```bash
curl -s -X POST http://localhost:3000/api/bookings/$REF/pay \
  -H 'content-type: application/json' -H "Authorization: Bearer $ATTENDEE_TOKEN" \
  -d '{"paymentToken":"tok_declined"}'
```

A valid card (`200`, `"status":"paid"`):

```bash
curl -s -X POST http://localhost:3000/api/bookings/$REF/pay \
  -H 'content-type: application/json' -H "Authorization: Bearer $ATTENDEE_TOKEN" \
  -d '{"paymentToken":"tok_success"}'
```

Paying again gets `409 INVALID_TRANSITION`, and the card is not charged a second time.

## 11. Cancel an unpaid booking (the attendee who made it)

Make a second booking (step 8) and cancel it. Its seats go back to the tier.

```bash
curl -s -X POST http://localhost:3000/api/bookings/$REF/cancel \
  -H "Authorization: Bearer $ATTENDEE_TOKEN"
```

`200` with `"status":"cancelled"`. A paid booking gets `409 INVALID_STATE`:
cancelling paid bookings means refunds, which arrive in Build 8.

## Health check

```bash
curl -s http://localhost:3000/health
```
