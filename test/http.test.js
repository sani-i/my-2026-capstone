import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/http/app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

async function withServer(run) {
  const { server } = createApp({ publicDir });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test("GET /health returns status ok", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { status: "ok" });
  });
});

test("unknown /api path returns JSON 404 with error shape", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.deepEqual(body.error.code, "NOT_FOUND");
    assert.equal(typeof body.error.message, "string");
  });
});

test("bad JSON returns JSON 400 with error shape", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/health`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json",
    });
    // /health is GET only; router won't match POST /health. But bad JSON should be caught before routing? 
    // Our app parses JSON body for non-GET/HEAD with json content-type before matching. So 400 BAD_JSON.
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "BAD_JSON");
  });
});

test("static files are served from public and path escape is blocked", async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/index.html`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /Event Ticketing/);

    const escape = await fetch(`${baseUrl}/../package.json`);
    // Should not serve package.json; either 403 or 404, but never file contents.
    const escapeText = await escape.text();
    assert.doesNotMatch(escapeText, /"name"\s*:\s*"event-ticketing-capstone"/);
  });
});
