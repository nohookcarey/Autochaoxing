import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

class MiniElement {
  constructor(value = "") { this.value = value; }
  getAttribute(name) { return name === "value" ? this.value : null; }
}

function documentFor(html) {
  const values = Object.fromEntries([...html.matchAll(/<input\s+id="([^"]+)"\s+value="([^"]*)"/g)].map((match) => [match[1], match[2]]));
  const rowCount = (html.match(/class="dataBody_td"/g) || []).length;
  const login = html.includes("type=\"password\"") ? new MiniElement() : null;
  return {
    body: { innerText: html, textContent: html },
    querySelector(selector) {
      if (selector.includes("password")) return login;
      const match = selector.match(/^#(.+)$/);
      return match && Object.hasOwn(values, match[1]) ? new MiniElement(values[match[1]]) : null;
    },
    querySelectorAll(selector) {
      return selector === "ul.dataBody_td" ? Array.from({ length: rowCount }, () => new MiniElement()) : [];
    },
  };
}

function loadScanner() {
  const context = {
    globalThis: {},
    DOMParser: class { parseFromString(html) { return documentFor(html); } },
    URL,
    URLSearchParams,
  };
  vm.runInNewContext(readFileSync(resolve(process.cwd(), "extension/content/chapter-test-scan-core.js"), "utf8"), context);
  return context.globalThis.LearningTongChapterTestScan;
}

const scanner = loadScanner();

test("chapter test parser follows the asynchronous mark-list contract", () => {
  const shell = scanner.parseMarkShell('<input id="courseid" value="100"><input id="clazzid" value="200"><input id="workid" value="300"><input id="submitCount" value="41"><input id="unSubmitCount" value="9">');
  assert.equal(shell.ok, true);
  assert.equal(shell.workId, "300");
  assert.equal(shell.submitted, 41);

  const empty = scanner.parsePendingList('<input id="totalPage" value="1"><div>暂无数据</div>');
  assert.deepEqual({ ok: empty.ok, pending: empty.pending, totalPages: empty.totalPages }, { ok: true, pending: 0, totalPages: 1 });
  const found = scanner.parsePendingList('<input id="totalPage" value="2"><ul class="dataBody_td"></ul><ul class="dataBody_td"></ul>');
  assert.equal(found.pending, 2);
  assert.equal(found.totalPages, 2);
});

test("chapter test aggregation distinguishes 采集到, 确认无数据, and 未获取", () => {
  const empty = scanner.aggregateTargetResults([
    { ok: true, className: "演示3班", num: "2.1", title: "任务一", pending: 0 },
    { ok: true, className: "演示4班", num: "2.1", title: "任务一", pending: 0 },
  ], 2);
  assert.equal(empty.acquisitionState, "确认无数据");
  assert.equal(empty.scannedTargets, 2);

  const found = scanner.aggregateTargetResults([
    { ok: true, className: "演示3班", num: "2.1", title: "任务一", pending: 2 },
  ], 1);
  assert.equal(found.acquisitionState, "采集到");
  assert.equal(found.pendingTotal, 2);
  assert.deepEqual(Array.from(found.classSummary[0].pendingTests, (item) => item.num), ["2.1"]);

  const missing = scanner.aggregateTargetResults([{ ok: false, reason: "页面改版" }], 1);
  assert.equal(missing.acquisitionState, "未获取");
});

test("chapter test URLs use pending-only status and contain no student query", () => {
  const url = new URL(scanner.makePendingListUrl({ origin: "https://example.test", courseId: "1", clazzId: "2", cpi: "3", workId: "4" }));
  assert.equal(url.searchParams.get("status"), "3");
  assert.equal(url.searchParams.get("size"), "100");
  assert.equal(url.searchParams.has("student"), false);
});
