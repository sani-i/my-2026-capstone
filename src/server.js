import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./http/app.js";
import { config } from "./config.js";
import { createSqliteRepository } from "./repositories/sqlite.js";
import { createEventService } from "./services/eventService.js";
import { createBookingService } from "./services/bookingService.js";
import { createAuthService } from "./services/authService.js";
import { createSeatService } from "./services/seatService.js";
import { createWaitlistService } from "./services/waitlistService.js";
import { createCheckinService } from "./services/checkinService.js";
import { createRateLimiter } from "./lib/rateLimit.js";
import { createMockPaymentGateway } from "./lib/mockPaymentGateway.js";
import { createClock } from "./lib/clock.js";
import { createMaintenanceJob } from "./jobs/maintenance.js";
import { registerApiRoutes } from "./http/routes.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { createDatabase } from "./db/connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const schemaPath = path.resolve(__dirname, "./db/schema.sql");
const dbPath = path.resolve(__dirname, "..", config.dbPath);

const schemaSql = fs.readFileSync(schemaPath, "utf8");
const db = createDatabase(dbPath, schemaSql);

const clock = createClock();
const repo = createSqliteRepository(db);
const paymentGateway = createMockPaymentGateway();
const eventService = createEventService(repo);
const seatService = createSeatService(repo, { clock });
const bookingService = createBookingService(repo, paymentGateway, { clock, seatService });
const waitlistService = createWaitlistService(repo, { clock, seatService, bookingService });
const authService = createAuthService(repo);
const checkinService = createCheckinService(repo, { clock });
const maintenance = createMaintenanceJob({ bookingService, seatService });

// Separate buckets: a busy door must not lock attendees out of login.
const loginLimiter = createRateLimiter({ max: 10, windowMs: 60 * 1000 });
const checkinLimiter = createRateLimiter({ max: 30, windowMs: 60 * 1000 });

const { server } = createApp({
  publicDir,
  rateLimiters: {
    "POST /api/auth/login": loginLimiter,
    "POST /api/checkin": checkinLimiter,
  },
  registerRoutes(router, helpers) {
    registerAuthRoutes(router, { authService });
    registerApiRoutes(router, {
      ...helpers,
      eventService,
      bookingService,
      waitlistService,
      checkinService,
    });
  },
});

server.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
  console.log(`Database: ${dbPath}`);
  if (!process.env.AUTH_SECRET && process.env.NODE_ENV !== "production") {
    console.log("Using development token secret. Set AUTH_SECRET before deploying.");
  }
  if (!process.env.TICKET_SECRET && process.env.NODE_ENV !== "production") {
    console.log("Using development ticket secret. Set TICKET_SECRET before deploying.");
  }
  // Every minute: expire unpaid holds, then pass freed seats down the waitlist.
  maintenance.start();
  console.log("Maintenance job started (every 60s).");
});

server.on("close", () => maintenance.stop());
