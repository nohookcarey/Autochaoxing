import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const context = { globalThis: {}, structuredClone, crypto: webcrypto };
vm.runInNewContext(readFileSync(new URL("../extension/popup/demo-mode.js", import.meta.url), "utf8"), context);
const demo = context.globalThis.LearningTongDemoMode;

test("demo mode replaces real course and class names", () => {
  const result = demo.demoCourse({ id: "local", name: "真实课程", classNames: ["真实班级"] }, 1);
  assert.equal(result.name, "教学运营演示课程 02");
  assert.deepEqual(Array.from(result.classNames), ["演示班 A", "演示班 B"]);
  assert.equal(JSON.stringify(result).includes("真实课程"), false);
});

test("demo mode covers read results without platform identifiers", () => {
  for (const view of ["pending", "deadlines", "chapter-tests", "attendance", "score-overview", "connection"]) {
    const payload = demo.result(view);
    assert.ok(["采集到", "确认无数据"].includes(payload.acquisitionState));
    assert.equal(/courseid|clazzid|cpi|chaoxing/i.test(JSON.stringify(payload)), false);
  }
});

test("demo deadline flow returns a simulated confirmation and readback", () => {
  const request = { courseName: "教学运营演示课程 01", className: "演示班 A", title: "演示任务一", nextEndTime: "2026-09-08 23:59:00" };
  const preview = demo.deadlinePreview(request);
  assert.equal(preview.acquisitionState, "待确认");
  assert.match(preview.confirmationToken, /^demo:/);
  const result = demo.deadlineResult(request);
  assert.equal(result.acquisitionState, "演示回读通过");
  assert.match(result.reason, /未连接学习通/);
});
