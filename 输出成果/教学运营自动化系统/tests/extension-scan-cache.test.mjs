import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = { globalThis: {} };
vm.runInNewContext(readFileSync(new URL("../extension/scan-cache-core.js", import.meta.url), "utf8"), context);
const cache = context.globalThis.LearningTongScanCache;

test("relativeTimeText covers 刚刚/分钟/小时/跨年 boundaries", () => {
  const now = Date.now();
  assert.equal(cache.relativeTimeText(now, now), "刚刚");
  assert.equal(cache.relativeTimeText(now - 61 * 1000, now), "1 分钟前");
  assert.equal(cache.relativeTimeText(now - 61 * 60 * 1000, now), "1 小时前");
  assert.equal(cache.relativeTimeText(now - 25 * 60 * 60 * 1000, now), "昨天".length >= 0 ? cache.relativeTimeText(now - 25 * 60 * 60 * 1000, now) : "");
  assert.equal(cache.relativeTimeText("bad", now), "");
  assert.equal(cache.relativeTimeText(now + 1000, now), "");
  const old = new Date(now - 400 * 24 * 60 * 60 * 1000);
  assert.match(cache.relativeTimeText(old.getTime(), now), /^\d{4}年\d+月\d+日$/);
});

test("badgeTextFor renders empty for zero and clamps at 99+", () => {
  assert.equal(cache.badgeTextFor(0), "");
  assert.equal(cache.badgeTextFor(undefined), "");
  assert.equal(cache.badgeTextFor(7), "7");
  assert.equal(cache.badgeTextFor(99), "99");
  assert.equal(cache.badgeTextFor(100), "99+");
});

test("mergeLastScan keeps other courses and tasks intact", () => {
  const base = cache.mergeLastScan(undefined, { courseName: "自然语言处理", taskKey: "attendance", at: 1, state: "采集到" });
  const next = cache.mergeLastScan(base, { courseName: "自然语言处理", taskKey: "score", at: 2, state: "未获取" });
  const other = cache.mergeLastScan(next, { courseName: "机器学习", taskKey: "attendance", at: 3, state: "采集到" });
  assert.equal(cache.lastScanOf(other, "自然语言处理", "attendance").at, 1);
  assert.equal(cache.lastScanOf(other, "自然语言处理", "score").state, "未获取");
  assert.equal(cache.lastScanOf(other, "机器学习", "attendance").at, 3);
  assert.equal(cache.lastScanOf(other, "自然语言处理", "chapter"), undefined);
  assert.equal(cache.lastScanOf(other, "", "attendance"), undefined);
  assert.equal(cache.mergeLastScan(other, { taskKey: "", at: 1, state: "采集到" }), other);
});

test("scanSummaryFor formats pending counts and skips transient states", () => {
  const payload = {
    acquisitionState: "采集到",
    assignmentTotal: 5,
    pendingAssignments: [{ className: "A班", pending: 3 }, { className: "B班", pending: 0 }],
  };
  assert.equal(cache.scanSummaryFor("assignment-pending", payload), "待批 3 项（共 5 个作业）");
  assert.equal(cache.scanSummaryFor("assignment-pending", { acquisitionState: "确认无数据" }), "白名单班级暂无待批作业");
  assert.equal(cache.scanSummaryFor("assignment-pending", { acquisitionState: "正在扫描" }), undefined);
  assert.equal(cache.scanSummaryFor("assignment-deadlines", { acquisitionState: "采集到", assignmentDeadlines: [{}, {}] }), "采集 2 个作业的截止时间");
  assert.match(cache.scanSummaryFor("attendance", { acquisitionState: "未获取", reason: "班级活动页未打开" }), /班级活动页未打开/);
});

function createBackgroundHarness() {
  const storageSets = [];
  const badgeCalls = [];
  const notifications = [];
  const chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage() { return Promise.resolve(); },
      lastError: undefined,
      getURL: (path) => `chrome-extension://test/${path}`,
    },
    scripting: { async executeScript() {} },
    storage: {
      session: { async set() {}, async get() { return {}; }, async remove() {} },
      local: { async get() { return {}; }, async set(obj) { storageSets.push(obj); } },
    },
    action: {
      setBadgeText(details) { badgeCalls.push(details); },
      setBadgeBackgroundColor() {},
    },
    notifications: { create(id, options) { notifications.push({ id, options }); } },
    tabs: {
      query(query, callback) { callback([]); },
      get(tabId, callback) { callback(undefined); },
      sendMessage(tabId, message, options, callback) { callback(undefined); },
      create(options, callback) { callback({ id: 99 }); },
      remove(tabId, callback) { callback?.(); },
      update(tabId, properties, callback) { callback?.(); },
    },
    webNavigation: { getAllFrames({ tabId }, callback) { callback([]); } },
  };
  const context = {
    chrome, AbortController, URL, URLSearchParams,
    globalThis: undefined, importScripts() {}, setTimeout, clearTimeout, console,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(new URL("../extension/scan-cache-core.js", import.meta.url), "utf8"), context);
  vm.runInNewContext(readFileSync(new URL("../extension/background-utils.js", import.meta.url), "utf8"), context);
  vm.runInNewContext(readFileSync(new URL("../extension/content/connection-check-scan-core.js", import.meta.url), "utf8"), context);
  vm.runInNewContext(readFileSync(new URL("../extension/content/assignment-scan-core.js", import.meta.url), "utf8"), context);
  const background = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
  vm.runInNewContext(`${background}\nglobalThis.__scanCacheTest = { recordScanResult };`, context);
  return { api: context.__scanCacheTest, storageSets, badgeCalls, notifications };
}

test("recordScanResult persists cache, badge and notification for assignment scans", async () => {
  const harness = createBackgroundHarness();
  await harness.api.recordScanResult(
    { type: "scan-active-assignment-page", profile: { courseName: "自然语言处理" } },
    { acquisitionState: "采集到", assignmentTotal: 4, pendingAssignments: [{ pending: 12 }, { pending: 0 }] },
  );
  const stored = harness.storageSets.at(-1)?.lastScans;
  assert.equal(stored["自然语言处理"]["assignment-pending"].pendingTotal, 12);
  assert.match(stored["自然语言处理"]["assignment-pending"].summary, /待批 12 项/);
  assert.equal(harness.badgeCalls.at(-1)?.text, "12");
  assert.equal(harness.notifications.length, 1);
  assert.match(harness.notifications[0].options.message, /作业待批扫描：采集到——待批 12 项/);
});

test("recordScanResult clears badge when no pending assignments remain", async () => {
  const harness = createBackgroundHarness();
  await harness.api.recordScanResult(
    { type: "scan-active-assignment-page", profile: { courseName: "自然语言处理" } },
    { acquisitionState: "确认无数据", pendingAssignments: [] },
  );
  assert.equal(harness.badgeCalls.at(-1)?.text, "");
  const stored = harness.storageSets.at(-1)?.lastScans;
  assert.equal(stored["自然语言处理"]["assignment-pending"].state, "确认无数据");
});

test("recordScanResult ignores non-scan messages and notification failures", async () => {
  const harness = createBackgroundHarness();
  await harness.api.recordScanResult({ type: "check-active-connection" }, { acquisitionState: "采集到" });
  assert.equal(harness.storageSets.length, 0);
  await harness.api.recordScanResult({ type: "scan-active-attendance", courseName: "自然语言处理" }, undefined);
  assert.equal(harness.storageSets.length, 0);
});
