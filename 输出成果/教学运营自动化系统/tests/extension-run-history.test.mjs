import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = { globalThis: {} };
vm.runInNewContext(readFileSync(new URL("../extension/popup/run-history.js", import.meta.url), "utf8"), context);
const history = context.globalThis.LearningTongRunHistory;

const runs = [
  { state: "采集到", taskName: "扫描作业" },
  { state: "确认无数据", taskName: "扫描章节测试" },
  { state: "需人工登录", taskName: "签到异常" },
  { state: "页面结构变化", taskName: "课程概览" },
  { state: "正在扫描", taskName: "历史兼容记录" },
];

test("run history separates attention and completed states", () => {
  assert.deepEqual(Array.from(history.filterRuns(runs, "attention"), (run) => run.taskName), ["签到异常", "课程概览"]);
  assert.deepEqual(Array.from(history.filterRuns(runs, "completed"), (run) => run.taskName), ["扫描作业", "扫描章节测试"]);
});

test("run history summary keeps unknown legacy states visible only in all", () => {
  const summary = history.summarize(runs);
  assert.deepEqual({ ...summary }, { total: 5, attention: 2, completed: 2 });
  assert.equal(history.filterRuns(runs, "all").length, 5);
});

test("run history accepts missing storage safely", () => {
  assert.deepEqual(Array.from(history.filterRuns(undefined, "attention")), []);
  assert.deepEqual({ ...history.summarize(undefined) }, { total: 0, attention: 0, completed: 0 });
});
