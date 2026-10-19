import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = { globalThis: {} };
vm.runInNewContext(readFileSync(new URL("../extension/content/course-overview-scan-core.js", import.meta.url), "utf8"), context);
const core = context.globalThis.LearningTongCourseOverviewScan;

test("course overview parses aggregate metrics", () => {
  const metrics = core.parseMetrics("班级数 6 选课学生数 210 课程资源建设概览 章节资源总数 80 创建作业 12 章节测验 发布测验数 9");
  assert.equal(metrics.classCount.value, 6);
  assert.equal(metrics.studentCount.value, 210);
  assert.equal(metrics.chapterResourceCount.value, 80);
  assert.equal(metrics.createdAssignmentCount.value, 12);
  assert.equal(metrics.publishedChapterTestCount.value, 9);
});

test("course overview distinguishes acquired and incomplete pages", () => {
  const snapshot = { bodyText: "自然语言处理", statisticsRole: true, metrics: { classCount: { value: 2 }, studentCount: { value: 60 }, chapterResourceCount: { value: 20 } } };
  const acquired = core.aggregate([{ snapshot }], "自然语言处理");
  assert.equal(acquired.acquisitionState, "采集到");
  assert.equal(acquired.signals.aggregateOnly, true);
  assert.match(acquired.reason, /未读取学生姓名或个人成绩/);
  assert.equal(core.aggregate([{ snapshot }], "其他课程").acquisitionState, "未获取");
});
