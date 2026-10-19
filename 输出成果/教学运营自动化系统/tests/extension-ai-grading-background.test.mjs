import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

function createHarness(fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) })) {
  const storage = {
    local: {
      data: {},
      async remove(key) { delete this.data[key]; },
      async get(key) { return this.data[key] !== undefined ? { [key]: this.data[key] } : {}; },
      async set(entry) { Object.assign(this.data, entry); },
    },
  };
  storage.session = { data: {}, async get(key) { return { [key]: this.data[key] }; }, async set(entry) { Object.assign(this.data, entry); }, async remove(key) { delete this.data[key]; } };
  const chrome = {
    runtime: { lastError: undefined, onMessage: { listeners: [], addListener(fn) { this.listeners.push(fn); } }, sendMessage: () => Promise.resolve() },
    storage,
    scripting: { async executeScript() {} },
    tabs: {
      query(query, callback) { callback([]); },
      get(tabId, callback) { callback(undefined); },
      sendMessage(tabId, message, options, callback) { callback(undefined); },
      create(options, callback) { callback({ id: 99 }); },
      remove(tabId, callback) { callback?.(); },
      update(tabId, properties, callback) { callback?.(); },
    },
    webNavigation: { getAllFrames({ tabId }, callback) { callback([{ frameId: 0, url: "" }]); } },
  };
  const context = {
    AbortController,
    URL,
    URLSearchParams,
    atob,
    btoa,
    chrome,
    fetch: fetchImpl,
    globalThis: undefined,
    importScripts() {},
    setTimeout,
    clearTimeout,
    structuredClone,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(new URL("../extension/grading-batch-core.js", import.meta.url), "utf8"), context);
  vm.runInNewContext(readFileSync(new URL("../extension/background-utils.js", import.meta.url), "utf8"), context);
  vm.runInNewContext(readFileSync(new URL("../extension/content/connection-check-scan-core.js", import.meta.url), "utf8"), context);
  vm.runInNewContext(readFileSync(new URL("../extension/content/assignment-scan-core.js", import.meta.url), "utf8"), context);
  vm.runInNewContext(readFileSync(new URL("../extension/content/ai-grading-core.js", import.meta.url), "utf8"), context);
  const background = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
  vm.runInNewContext(`${background}\nglobalThis.__aiTest = { loadAiConfig, saveAiConfig, callAiChatCompletion, sendRuntimeMessage: (message) => new Promise((resolve) => { for (const listener of chrome.runtime.onMessage.listeners) { let answered = false; const keepOpen = listener(message, { url: "https://mooc1.chaoxing.com/work/library/review-work" }, (value) => { answered = true; resolve(value); }); if (answered || keepOpen !== true) break; } }) };`, context);
  return { api: context.__aiTest, storage: storage.local };
}

const VALID_CONFIG = { baseUrl: "https://api.example.com/v1", apiKey: "sk-test", model: "demo-model", criteria: "按要点" };

test("ai-attachment-download fetches bytes and returns base64", async () => {
  const payload = new TextEncoder().encode("学生附件内容 student attachment");
  const harness = createHarness(async (url, options) => {
    assert.equal(url, "https://files.chaoxing.com/a.pdf");
    assert.equal(options.credentials, "include");
    return { ok: true, status: 200, arrayBuffer: async () => payload.buffer };
  });
  const response = await harness.api.sendRuntimeMessage({
    type: "ai-attachment-download",
    attachment: { kind: "pdf", fileName: "a.pdf", href: "https://files.chaoxing.com/a.pdf" },
  });
  assert.equal(response.ok, true);
  assert.equal(Buffer.from(response.dataBase64, "base64").toString("utf8"), "学生附件内容 student attachment");
});

test("ai-attachment-download reports http failures", async () => {
  const harness = createHarness(async () => ({ ok: false, status: 404 }));
  const response = await harness.api.sendRuntimeMessage({
    type: "ai-attachment-download",
    attachment: { kind: "pdf", fileName: "a.pdf", href: "https://files.chaoxing.com/a.pdf" },
  });
  assert.equal(response.ok, false);
  assert.match(response.reason, /HTTP 404/);
});

test("ai-attachment-download rejects invalid links", async () => {
  const harness = createHarness();
  const response = await harness.api.sendRuntimeMessage({
    type: "ai-attachment-download",
    attachment: { kind: "pdf", fileName: "a.pdf", href: "javascript:alert(1)" },
  });
  assert.equal(response.ok, false);
  assert.match(response.reason, /附件链接无效/);
});

test("ai-attachment-download surfaces network errors", async () => {
  const harness = createHarness(async () => { throw new Error("network down"); });
  const response = await harness.api.sendRuntimeMessage({
    type: "ai-attachment-download",
    attachment: { kind: "pdf", fileName: "a.pdf", href: "https://files.chaoxing.com/a.pdf" },
  });
  assert.equal(response.ok, false);
  assert.match(response.reason, /network down/);
});

test("saveAiConfig normalizes and loadAiConfig reads back", async () => {
  const harness = createHarness();
  await harness.api.saveAiConfig({ baseUrl: "https://api.example.com/v1/", apiKey: " sk-test ", model: " demo-model " });
  const loaded = await harness.api.loadAiConfig();
  assert.equal(loaded.baseUrl, "https://api.example.com/v1");
  assert.equal(loaded.apiKey, "sk-test");
  assert.equal(harness.storage.data.aiGradingConfig.apiKey, "");
  assert.equal(loaded.model, "demo-model");
});
test("remembering the AI key requires an explicit opt-in", async () => {
  const harness = createHarness();
  await harness.api.saveAiConfig({ ...VALID_CONFIG, rememberKey: true });
  assert.equal(harness.storage.data.aiGradingConfig.apiKey, "sk-test");
  await harness.api.saveAiConfig({ ...VALID_CONFIG, rememberKey: false });
  assert.equal(harness.storage.data.aiGradingConfig.apiKey, "");
});

test("ai-grade-request honours the comment toggle end to end", async () => {
  const bodies = [];
  const harness = createHarness(async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"score": 42}' } }] }) };
  });
  await harness.api.saveAiConfig({ ...VALID_CONFIG, commentEnabled: false });
  const gradingContext = { question: "1. 简答题", studentAnswer: "答案", maxScore: 100 };
  const response = await harness.api.sendRuntimeMessage({ type: "ai-grade-request", context: gradingContext });
  assert.equal(response.ok, true);
  assert.equal(response.score, 42);
  assert.equal(response.comment, "");
  assert.equal(response.commentEnabled, false);
  const systemPrompt = bodies[0].messages[0].content;
  assert.doesNotMatch(systemPrompt, /"comment"/);
  assert.match(systemPrompt, /不要输出评语/);
  assert.equal(bodies[0].max_tokens, 800);
});

test("ai-grade-request keeps requesting comments when the toggle stays on", async () => {
  const bodies = [];
  const harness = createHarness(async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"score": 42}' } }] }) };
  });
  await harness.api.saveAiConfig({ ...VALID_CONFIG, commentEnabled: true });
  const response = await harness.api.sendRuntimeMessage({ type: "ai-grade-request", context: { question: "1. 简答题", studentAnswer: "答案", maxScore: 100 } });
  assert.equal(response.ok, true);
  assert.match(bodies[0].messages[0].content, /"comment"/);
  assert.equal(bodies[0].max_tokens, 2000);
  assert.match(response.comment, /手动补充/);
});

test("callAiChatCompletion posts OpenAI-compatible payload and returns content", async () => {
  let captured;
  const harness = createHarness(async (url, options) => {
    captured = { url, options };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"score":90}' } }] }) };
  });
  const completion = await harness.api.callAiChatCompletion(VALID_CONFIG, [{ role: "user", content: "hi" }]);
  assert.equal(completion.ok, true);
  assert.equal(completion.content, '{"score":90}');
  assert.equal(captured.url, "https://api.example.com/v1/chat/completions");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers.Authorization, "Bearer sk-test");
  const body = JSON.parse(captured.options.body);
  assert.equal(body.model, "demo-model");
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
});

test("callAiChatCompletion explains auth, missing-model and server errors", async () => {
  const failing = (status, text = "") => createHarness(async () => ({ ok: false, status, json: async () => ({}), text: async () => text }));
  const auth = await failing(401).api.callAiChatCompletion(VALID_CONFIG, []);
  assert.equal(auth.ok, false);
  assert.match(auth.reason, /鉴权失败/);
  const missing = await failing(404).api.callAiChatCompletion(VALID_CONFIG, []);
  assert.match(missing.reason, /404/);
  const server = await failing(500).api.callAiChatCompletion(VALID_CONFIG, []);
  assert.match(server.reason, /异常状态 500/);
});

test("429 balance errors surface the provider's own message", async () => {
  const harness = createHarness(async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => '{"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}' }));
  const balance = await harness.api.callAiChatCompletion(VALID_CONFIG, []);
  assert.equal(balance.ok, false);
  assert.match(balance.reason, /余额不足/);
  assert.match(balance.reason, /充值/);
});

test("429 rate-limit errors stay distinct from balance errors", async () => {
  const harness = createHarness(async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => '{"error":{"message":"Too many concurrent requests"}}' }));
  const limited = await harness.api.callAiChatCompletion(VALID_CONFIG, []);
  assert.match(limited.reason, /请求过于频繁/);
});

test("Zhipu coding-plan balance errors fall back to the Anthropic endpoint", async () => {
  const calls = [];
  const zhipuConfig = { ...VALID_CONFIG, baseUrl: "https://open.bigmodel.cn/api/paas/v4" };
  const harness = createHarness(async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    if (url.includes("/api/paas/v4/chat/completions")) {
      return { ok: false, status: 429, json: async () => ({}), text: async () => '{"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}' };
    }
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: '{"score": 90}' }], stop_reason: "end_turn" }) };
  });
  const result = await harness.api.callAiChatCompletion(zhipuConfig, [
    { role: "system", content: "评分规则" },
    { role: "user", content: "批改" },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.content, '{"score": 90}');
  assert.match(result.note, /Anthropic 端点/);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /open\.bigmodel\.cn\/api\/anthropic\/v1\/messages$/);
  assert.equal(calls[1].headers["x-api-key"], "sk-test");
  assert.equal(calls[1].body.system, "评分规则");
  assert.equal(calls[1].body.messages.length, 1);
  assert.equal(calls[1].body.messages[0].role, "user");
});

test("anthropic-protocol base URLs call the messages endpoint directly", async () => {
  const calls = [];
  const anthropicConfig = { ...VALID_CONFIG, baseUrl: "https://open.bigmodel.cn/api/anthropic" };
  const harness = createHarness(async (url, options) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "thinking", thinking: "嗯…" }, { type: "text", text: '{"score": 60}' }], stop_reason: "end_turn" }) };
  });
  const result = await harness.api.callAiChatCompletion(anthropicConfig, [{ role: "user", content: "批改" }]);
  assert.equal(result.ok, true);
  assert.equal(result.content, '{"score": 60}');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/anthropic\/v1\/messages$/);
  assert.equal(result.note, undefined);
});

test("truncated anthropic thinking responses retry with a larger budget", async () => {
  const calls = [];
  const anthropicConfig = { ...VALID_CONFIG, baseUrl: "https://open.bigmodel.cn/api/anthropic" };
  const harness = createHarness(async (url, options) => {
    calls.push(JSON.parse(options.body).max_tokens);
    if (calls.length === 1) {
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "thinking", thinking: "思考中…" }], stop_reason: "max_tokens" }) };
    }
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: '{"score": 70}' }], stop_reason: "end_turn" }) };
  });
  const result = await harness.api.callAiChatCompletion(anthropicConfig, [{ role: "user", content: "批改" }], { maxTokens: 500 });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [500, 4000]);
});

test("non-Zhipu balance errors do not trigger the fallback", async () => {
  const calls = [];
  const harness = createHarness(async (url) => {
    calls.push(url);
    return { ok: false, status: 429, json: async () => ({}), text: async () => '{"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}' };
  });
  const result = await harness.api.callAiChatCompletion(VALID_CONFIG, []);
  assert.equal(result.ok, false);
  assert.match(result.reason, /余额不足/);
  assert.equal(calls.length, 1);
});

test("callAiChatCompletion requires a complete configuration", async () => {
  const harness = createHarness();
  const unconfigured = await harness.api.callAiChatCompletion({ apiKey: "" }, []);
  assert.equal(unconfigured.ok, false);
  assert.match(unconfigured.reason, /未配置/);
});

test("callAiChatCompletion surfaces network failures without throwing", async () => {
  const harness = createHarness(async () => { throw new Error("network down"); });
  const failed = await harness.api.callAiChatCompletion(VALID_CONFIG, []);
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /network down/);
});

test("callAiChatCompletion handles empty AI responses", async () => {
  const harness = createHarness(async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) }));
  const empty = await harness.api.callAiChatCompletion(VALID_CONFIG, []);
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /未返回评分内容/);
});

test("truncated thinking-model responses are retried with a larger token budget", async () => {
  const calls = [];
  const harness = createHarness(async (url, options) => {
    calls.push(JSON.parse(options.body).max_tokens);
    if (calls.length === 1) {
      return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "思考中…" } }] }) };
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: '{"score": 80, "comment": "合格"}' } }] }) };
  });
  const result = await harness.api.callAiChatCompletion(VALID_CONFIG, [{ role: "user", content: "hi" }]);
  assert.equal(result.ok, true);
  assert.equal(result.content, '{"score": 80, "comment": "合格"}');
  assert.deepEqual(calls, [800, 4000]);
});

test("reasoning-only responses without truncation report a clear error", async () => {
  const harness = createHarness(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: "", reasoning_content: "只有思考" } }] }) }));
  const result = await harness.api.callAiChatCompletion(VALID_CONFIG, []);
  assert.equal(result.ok, false);
  assert.match(result.reason, /思考内容但没有评分正文/);
});

test("persistently truncated responses surface the truncation reason", async () => {
  const harness = createHarness(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "太长了" } }] }) }));
  const result = await harness.api.callAiChatCompletion(VALID_CONFIG, [], { maxTokens: 500 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /截断/);
});
