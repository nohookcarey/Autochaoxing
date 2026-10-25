import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = { globalThis: {} };
vm.runInNewContext(readFileSync(new URL("../extension/content/chapter-structure-scan-core.js", import.meta.url), "utf8"), context);
const core = context.globalThis.LearningTongChapterStructureScan;

test("chapter structure returns a read-only aggregate", () => {
  const summary = { chapterCount: 2, sectionCount: 4, taskPointCount: 8, openCount: 4, closedCount: 0, chapters: [{ title: "第一章" }, { title: "第二章" }] };
  const result = core.aggregate([{ snapshot: { title: "自然语言处理", chapterRole: true, summary } }], "自然语言处理");
  assert.equal(result.acquisitionState, "采集到");
  assert.equal(result.signals.structureOnly, true);
  assert.match(result.reason, /未修改章节内容/);
});

test("chapter structure rejects wrong course and incomplete trees", () => {
  const wrong = core.aggregate([{ snapshot: { title: "其他课程", chapterRole: true, summary: {} } }], "自然语言处理");
  assert.equal(wrong.acquisitionState, "未获取");
  const incomplete = core.aggregate([{ snapshot: { title: "自然语言处理", chapterRole: true, summary: { chapterCount: 2, sectionCount: 4, chapters: [] } } }], "自然语言处理");
  assert.equal(incomplete.acquisitionState, "未获取");
});
