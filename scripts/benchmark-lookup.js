import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

const BOOKINGS = 100_000;
const LOOKUPS = 500;

function makeBooking(i) {
  return {
    id: randomUUID(),
    reference: `BK-${String(i).padStart(8, "0")}`,
    userName: `User-${i}`,
    quantity: 1,
    status: "confirmed",
  };
}

function main() {
  console.log(`Building ${BOOKINGS.toLocaleString()} bookings...`);
  const bookings = [];
  const bookingsByReference = new Map();

  for (let i = 0; i < BOOKINGS; i += 1) {
    const booking = makeBooking(i);
    bookings.push(booking);
    bookingsByReference.set(booking.reference, booking);
  }

  // Pick references to look up (spread across the array, including late ones).
  const targets = [];
  for (let i = 0; i < LOOKUPS; i += 1) {
    const idx = Math.floor((i / LOOKUPS) * BOOKINGS);
    targets.push(bookings[idx].reference);
  }

  console.log(`Looking up ${LOOKUPS} bookings among ${BOOKINGS.toLocaleString()}...\n`);

  // Array.find: O(n) per lookup -> O(LOOKUPS * n) total
  const tArrayStart = performance.now();
  let arrayFound = 0;
  for (const ref of targets) {
    const found = bookings.find((b) => b.reference === ref);
    if (found) arrayFound += 1;
  }
  const tArrayEnd = performance.now();
  const arrayMs = tArrayEnd - tArrayStart;

  // Map.get: O(1) per lookup -> O(LOOKUPS) total
  const tMapStart = performance.now();
  let mapFound = 0;
  for (const ref of targets) {
    const found = bookingsByReference.get(ref);
    if (found) mapFound += 1;
  }
  const tMapEnd = performance.now();
  const mapMs = tMapEnd - tMapStart;

  console.log(`Array.find: ${arrayMs.toFixed(3)} ms  (found ${arrayFound}/${LOOKUPS})`);
  console.log(`Map.get:    ${mapMs.toFixed(3)} ms  (found ${mapFound}/${LOOKUPS})`);

  if (mapMs > 0) {
    const ratio = arrayMs / mapMs;
    console.log(`\nMap.get was ~${ratio.toFixed(1)}x faster in this run.`);
  } else {
    console.log("\nMap.get was too fast to measure at ms precision (effectively instant).");
  }

  console.log("\nWhy (Big O):");
  console.log("  Array.find scans elements until it matches: O(n) per lookup.");
  console.log("  Map.get hashes the key to a bucket:      O(1) average per lookup.");
  console.log(`  For ${LOOKUPS} lookups in ${BOOKINGS.toLocaleString()} bookings:`);
  console.log(`    Array.find ~ O(${LOOKUPS} * ${BOOKINGS.toLocaleString()}) work`);
  console.log(`    Map.get    ~ O(${LOOKUPS}) work`);
  console.log("  Double BOOKINGS and Array.find roughly doubles; Map.get stays flat.");
}

main();
