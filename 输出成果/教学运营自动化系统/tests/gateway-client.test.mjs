import assert from "node:assert/strict";
import test from "node:test";
import { gatewayFetch } from "../src/gateway-client.mjs";

test("workbench reconnects after gateway restart without persisting or forwarding the session", async () => {
  const originalFetch = globalThis.fetch;
  let sessions = 0, requests = 0;
  globalThis.fetch = async (url, options) => {
    assert.ok(url.startsWith("http://127.0.0.1:4174/api/"));
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    if (url.endsWith("/session")) { sessions++; return Response.json({ token: String(sessions).repeat(64) }); }
    requests++;
    assert.equal(options.headers.get("x-local-session"), String(sessions).repeat(64));
    return Response.json({}, { status: requests === 1 ? 401 : 200 });
  };
  try {
    assert.equal((await gatewayFetch("/api/course-profiles")).status, 200);
    assert.equal((await gatewayFetch("/api/course-imports")).status, 200);
    assert.equal(sessions, 2); assert.equal(requests, 3);
    await assert.rejects(gatewayFetch("https://example.invalid/api/course-profiles"), /未开放/);
    assert.equal(requests, 3);
  } finally { globalThis.fetch = originalFetch; }
});
