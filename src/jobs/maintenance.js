/**
 * The scheduled job for Build 8. Tests call runOnce() directly with a
 * controllable clock; the server starts it with setInterval.
 */
export function createMaintenanceJob({
  bookingService,
  seatService,
  intervalMs = 60 * 1000,
  onError = (err) => console.error("maintenance job failed:", err),
} = {}) {
  if (!bookingService) throw new Error("maintenance job requires bookingService");
  if (!seatService) throw new Error("maintenance job requires seatService");

  let timer = null;

  async function runOnce() {
    const expiredBookings = await bookingService.expireUnpaidBookings();
    const expiredOffers = await seatService.expireStaleOffers();
    // Covers entries joined after a seat became free but before the next tick.
    const newOffers = await seatService.offerNextForAllTiers();
    return {
      expiredBookings: expiredBookings.count,
      expiredOffers: expiredOffers.length,
      offersCreated: newOffers.length,
    };
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      runOnce().catch(onError);
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { runOnce, start, stop };
}
