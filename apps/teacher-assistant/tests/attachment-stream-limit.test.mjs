import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = {};
vm.runInNewContext(readFileSync(new URL("../extension/background-utils.js", import.meta.url), "utf8"), context);
const { readBoundedResponse } = context.LearningTongBackgroundUtils;

test("attachment stream preserves normal and exact-limit bytes", async () => {
  assert.deepEqual(Array.from(await readBoundedResponse(new Response(new Uint8Array([1, 2, 3])), 3)), [1, 2, 3]);
  assert.deepEqual(Array.from(await readBoundedResponse(new Response(new Uint8Array([4])), 3)), [4]);
});

for (const declared of [undefined, "1"]) test(`attachment stream cancels over-limit body with declared length ${declared}`, async () => {
  let reads = 0, cancelled = false;
  const controller = new AbortController();
  const response = { headers: new Headers(declared ? { "content-length": declared } : {}), body: new ReadableStream({
    pull(stream) { reads++; stream.enqueue(new Uint8Array(4)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 }) };
  await assert.rejects(readBoundedResponse(response, 6, controller), /15MB/);
  assert.equal(reads, 2);
  assert.equal(cancelled, true);
  assert.equal(controller.signal.aborted, true);
});

test("attachment stream rejects oversized declared length before reading and refuses unbounded fallback", async () => {
  let reads = 0, cancelled = false;
  const response = { headers: new Headers({ "content-length": "7" }), body: new ReadableStream({
    pull() { reads++; }, cancel() { cancelled = true; },
  }, { highWaterMark: 0 }) };
  await assert.rejects(readBoundedResponse(response, 6), /15MB/);
  assert.equal(reads, 0); assert.equal(cancelled, true);
  await assert.rejects(readBoundedResponse({ arrayBuffer() { throw Error("must never run"); } }), /15MB/);
});
