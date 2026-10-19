import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

function loadGlobal(file, name) {
  const context = { globalThis: {} };
  vm.runInNewContext(readFileSync(resolve(process.cwd(), file), "utf8"), context);
  return context.globalThis[name];
}

const scanner = loadGlobal("extension/content/assignment-scan-core.js", "LearningTongAssignmentScan");
const background = loadGlobal("extension/background-utils.js", "LearningTongBackgroundUtils");
const profile = { courseName: "演示课程", classNames: ["演示1班", "演示2班"] };

test("extension scanner combines course shell and assignment iframe evidence", () => {
  const courseShell = scanner.scanSnapshot({ title: "演示课程", bodyText: "演示课程 作业", path: "/mycourse/tch", rows: [] }, profile);
  const workFrame = scanner.scanSnapshot({ title: "作业列表", bodyText: "作业列表 演示1班 2待批 演示2班 0待批", path: "/work/list", scannedPages: ["1", "2"], rows: [
    { id: "work1", title: "任务一", text: "演示1班 作答时间：09-01 08:00至 09-08 23:59 2待批 4已交 批阅", page: "1" },
    { id: "work2", title: "任务二", text: "演示2班 作答时间：09-02 08:00至 09-09 23:59 0待批 3已交 批阅", page: "2" },
  ] }, profile);
  assert.equal(courseShell.acquisitionState, "未获取");
  assert.equal(workFrame.candidateState, "采集到");
  const result = background.aggregateFrameResults([courseShell, workFrame]);
  assert.equal(result.acquisitionState, "采集到");
  assert.equal(result.signals.crossFrameVerified, true);
  assert.equal(result.pendingAssignments[0].pending, 2);
  assert.deepEqual(Array.from(result.scannedPages), ["1", "2"]);
  assert.match(result.reason, /2 个分页/);
  assert.equal(result.assignmentDeadlines.length, 2);
  assert.equal(result.assignmentDeadlines[0].deadline, "09-01 08:00至 09-08 23:59");
});

test("extension scanner keeps missing class scope as 未获取", () => {
  const result = scanner.scanSnapshot({ title: "作业列表", bodyText: "作业列表 演示1班 0待批", path: "/work/list", rows: [
    { id: "work1", title: "任务一", text: "演示1班 0待批 4已交 批阅" },
  ] }, profile);
  assert.equal(result.acquisitionState, "未获取");
  assert.equal(result.scopeVerified, false);
});

test("pickTargetTab uses the active Chaoxing tab", () => {
  const result = background.pickTargetTab([
    { id: 1, active: true, url: "chrome-extension://example/popup.html", lastAccessed: 30 },
    { id: 2, active: true, url: "https://mooc2-ans.chaoxing.com/course", lastAccessed: 20 },
    { id: 3, active: false, url: "https://stat2-ans.chaoxing.com/stat", lastAccessed: 40 },
  ]);
  assert.equal(result.id, 2);
});

test("pickTargetTab falls back to the most recently used Chaoxing tab", () => {
  const result = background.pickTargetTab([
    { id: 1, active: true, url: "chrome-extension://example/popup.html", lastAccessed: 50 },
    { id: 2, active: false, url: "https://mooc2-ans.chaoxing.com/course", lastAccessed: 20 },
    { id: 3, active: false, url: "https://stat2-ans.chaoxing.com/stat", lastAccessed: 40 },
  ]);
  assert.equal(result.id, 3);
});

test("pickTargetTab uses the most recently opened platform page when the extension page is active", () => {
  const result = background.pickTargetTab([
    { id: 1, active: true, url: "chrome-extension://example/popup.html", title: "教学运营助手", lastAccessed: 50 },
    { id: 2, active: false, url: "https://mooc2-ans.chaoxing.com/course", title: "AIGC 应用与实践", lastAccessed: 20 },
    { id: 3, active: false, url: "https://stat2-ans.chaoxing.com/stat", title: "课程-统计", lastAccessed: 40 },
  ], "AIGC 应用与实践");
  assert.equal(result.id, 3);
});

test("pickTargetTab does not select another course shell", () => {
  const result = background.pickTargetTab([
    { id: 1, active: true, url: "chrome-extension://example/popup.html", title: "教学运营助手", lastAccessed: 50 },
    { id: 2, active: false, url: "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/tch", title: "目标课程", lastAccessed: 20 },
    { id: 3, active: false, url: "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/tch", title: "另一门课程", lastAccessed: 40 },
  ], "目标课程");
  assert.equal(result.id, 2);
});
