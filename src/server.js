import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./http/app.js";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

const { server } = createApp({ publicDir });

server.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});
