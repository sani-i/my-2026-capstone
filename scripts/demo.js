import {
  addTier,
  bookTickets,
  cancelBooking,
  createEvent,
  createStore,
  findBookingByReference,
  joinWaitlist,
} from "../src/domain/inventory.js";
import { DomainError } from "../src/domain/errors.js";

function log(title) {
  console.log(`\n=== ${title} ===`);
}

function printBooking(booking) {
  console.log(
    `  booking ${booking.reference} | ${booking.userName} | qty=${booking.quantity} | ` +
      `amount=${booking.amountCents} cents | status=${booking.status}`,
  );
}

function main() {
  const store = createStore();

  log("1) Create event and tier");
  const event = createEvent(store, {
    title: "Lagos Tech Night",
    city: "Lagos",
    venue: "Main Hall",
    startsAt: "2026-12-01T18:00:00Z",
  });
  const tier = addTier(store, {
    eventId: event.id,
    name: "General Admission",
    priceCents: 5000,
    capacity: 3,
  });
  console.log(`  event: ${event.title} (${event.id})`);
  console.log(`  tier:  ${tier.name} | capacity=${tier.capacity} | price=${tier.priceCents} cents`);

  log("2) Ada books 2 of 3 seats");
  const adaBooking = bookTickets(store, {
    tierId: tier.id,
    userName: "Ada",
    quantity: 2,
  });
  printBooking(adaBooking);
  console.log(`  tier sold=${tier.sold}/${tier.capacity}`);

  log("3) Bayo tries to book 2 seats (only 1 left)");
  try {
    bookTickets(store, { tierId: tier.id, userName: "Bayo", quantity: 2 });
    console.log("  UNEXPECTED: booking should have failed");
  } catch (err) {
    if (err instanceof DomainError) {
      console.log(`  refused: [${err.code}] ${err.message}`);
    } else {
      throw err;
    }
  }
  console.log(`  tier sold=${tier.sold}/${tier.capacity} (unchanged after failure)`);

  log("4) Bayo books the last seat - event sells out");
  const bayoBooking = bookTickets(store, {
    tierId: tier.id,
    userName: "Bayo",
    quantity: 1,
  });
  printBooking(bayoBooking);
  console.log(`  tier sold=${tier.sold}/${tier.capacity} -> SOLD OUT`);

  log("5) Two people join the waitlist");
  const w1 = joinWaitlist(store, { tierId: tier.id, userName: "Chika" });
  const w2 = joinWaitlist(store, { tierId: tier.id, userName: "Dayo" });
  const waitlist = store.waitlistsByTier.get(tier.id);
  console.log(`  waitlist size: ${waitlist.size}`);
  console.log(`  joined: ${w1.userName}, then ${w2.userName}`);

  log("6) Find Ada's booking by reference (O(1) Map lookup)");
  const found = findBookingByReference(store, adaBooking.reference);
  console.log(`  found ${found.reference} for ${found.userName} (status=${found.status})`);

  log("7) Ada cancels - seats released, next person in line named");
  cancelBooking(store, adaBooking.id);
  console.log(`  cancelled ${adaBooking.reference} for ${adaBooking.userName}`);
  console.log(`  tier sold=${tier.sold}/${tier.capacity} (seats released)`);
  const nextInLine = waitlist.peek();
  if (nextInLine) {
    console.log(`  next person in line: ${nextInLine.userName}`);
  } else {
    console.log("  waitlist is empty");
  }

  log("Demo complete");
}

main();
