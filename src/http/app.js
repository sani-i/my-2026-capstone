import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { createRouter } from "./router.js";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const ERROR_STATUS = {
  VALIDATION: 400,
  INVALID_JSON: 400,
  BAD_JSON: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  EMAIL_TAKEN: 409,
  PAYMENT_DECLINED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SOLD_OUT: 409,
  INVALID_STATE: 409,
  INVALID_TRANSITION: 409,
  EVENT_STARTED: 409,
  BOOKING_EXPIRED: 409,
  NOT_SOLD_OUT: 409,
  ALREADY_ON_WAITLIST: 409,
  OFFER_EXPIRED: 409,
  REFUND_FAILED: 409,
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return "";
  return Buffer.concat(chunks).toString("utf8");
}

async function parseJsonBody(req) {
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return undefined;

  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const hasJsonContentType = contentType.includes("application/json");
  const body = await readBody(req);
  if (!body.trim()) return undefined;
  if (!hasJsonContentType) return undefined;

  try {
    return JSON.parse(body);
  } catch {
    const err = new Error("Invalid JSON body");
    err.code = "BAD_JSON";
    throw err;
  }
}

function safePublicPath(publicDir, urlPathname) {
  const decoded = decodeURIComponent(urlPathname.split("?")[0]);
  const relative = decoded === "/" ? "/index.html" : decoded;
  const normalized = path.normalize(relative).replace(/^([/\\])+/, "");
  const resolved = path.resolve(publicDir, normalized);
  const publicResolved = path.resolve(publicDir);
  if (!resolved.startsWith(publicResolved + path.sep) && resolved !== publicResolved) {
    return null;
  }
  return resolved;
}

async function serveStatic(req, res, publicDir) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;

  const url = new URL(req.url || "/", "http://localhost");
  const filePath = safePublicPath(publicDir, url.pathname);
  if (!filePath) {
    sendError(res, 403, "FORBIDDEN", "Forbidden");
    return true;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return false;
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
    });
    if (method === "HEAD") {
      res.end();
    } else {
      res.end(data);
    }
    return true;
  } catch {
    return false;
  }
}

export function createApp({ publicDir = path.resolve("public"), registerRoutes } = {}) {
  const router = createRouter();

  router.add("GET", "/health", async (_req, res) => {
    sendJson(res, 200, { status: "ok" });
  });

  if (typeof registerRoutes === "function") {
    registerRoutes(router, { sendJson, sendError });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const pathname = url.pathname;

      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        if (err?.code === "BAD_JSON") {
          sendError(res, 400, "BAD_JSON", "Invalid JSON body");
          return;
        }
        throw err;
      }

      const match = router.match(req.method, pathname);
      if (match) {
        await match.handler(req, res, {
          params: match.params,
          query: url.searchParams,
          body,
          url,
          sendJson: (status, payload) => sendJson(res, status, payload),
          sendError: (status, code, message) => sendError(res, status, code, message),
        });
        return;
      }

      if (pathname === "/api" || pathname.startsWith("/api/")) {
        sendError(res, 404, "NOT_FOUND", "Not found");
        return;
      }

      const served = await serveStatic(req, res, publicDir);
      if (served) return;

      sendError(res, 404, "NOT_FOUND", "Not found");
    } catch (err) {
      const code = typeof err?.code === "string" ? err.code : "INTERNAL_ERROR";
      const status = ERROR_STATUS[code] ?? (Number.isInteger(err?.status) ? err.status : 500);
      const message = status >= 500 ? "Internal server error" : String(err?.message || "Error");
      sendError(res, status, code, message);
    }
  });

  return { server, router, publicDir };
}
