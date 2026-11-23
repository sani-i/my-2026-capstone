import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./http/app.js";
import { config } from "./config.js";
import { createSqliteRepository } from "./repositories/sqlite.js";
import { createEventService } from "./services/eventService.js";
import { createBookingService } from "./services/bookingService.js";
import { createMockPaymentGateway } from "./lib/mockPaymentGateway.js";
import { registerApiRoutes } from "./http/routes.js";
import { createDatabase } from "./db/connection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");
const schemaPath = path.resolve(__dirname, "./db/schema.sql");
const dbPath = path.resolve(__dirname, "..", config.dbPath);

const schemaSql = fs.readFileSync(schemaPath, "utf8");
const db = createDatabase(dbPath, schemaSql);

const repo = createSqliteRepository(db);
const paymentGateway = createMockPaymentGateway();
const eventService = createEventService(repo);
const bookingService = createBookingService(repo, paymentGateway);

const { server } = createApp({
  publicDir,
  registerRoutes(router, helpers) {
    registerApiRoutes(router, { ...helpers, eventService, bookingService });
  },
});

server.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
  console.log(`Database: ${dbPath}`);
});
