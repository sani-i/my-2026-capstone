import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./http/app.js";
import { config } from "./config.js";
import { createMemoryRepository } from "./repositories/memory.js";
import { createEventService } from "./services/eventService.js";
import { createBookingService } from "./services/bookingService.js";
import { createMockPaymentGateway } from "./lib/mockPaymentGateway.js";
import { registerApiRoutes } from "./http/routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

const repo = createMemoryRepository();
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
});
