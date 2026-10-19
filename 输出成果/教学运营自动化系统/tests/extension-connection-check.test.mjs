import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const context = { globalThis: {} };
vm.runInNewContext(readFileSync(resolve(process.cwd(), "extension/content/connection-check-scan-core.js"), "utf8"), context);
const checker = context.globalThis.LearningTongConnectionCheck;

test("connection check requires the configured course and a teacher page role", () => {
  const found = checker.aggregate([
    { snapshot: { title: "演示课程", courseLabel: "演示课程", roles: { courseShell: true }, loginPage: false } },
    { snapshot: { title: "章节", roles: { chapter: true }, loginPage: false } },
  ], "演示课程");
  assert.equal(found.acquisitionState, "采集到");
  assert.deepEqual(Array.from(found.roles), ["courseShell", "chapter"]);

  const wrongCourse = checker.aggregate([{ snapshot: { title: "其他课程", roles: { courseShell: true }, loginPage: false } }], "演示课程");
  assert.equal(wrongCourse.acquisitionState, "未获取");
});

test("connection check keeps an explicit login page separate", () => {
  const result = checker.aggregate([{ snapshot: { title: "用户登录", roles: {}, loginPage: true } }], "演示课程");
  assert.equal(result.acquisitionState, "需人工登录");
});

test("aggregate exposes courseContext so the background can retry with auto-entry", () => {
  const missing = checker.aggregate([{ snapshot: { title: "个人空间", roles: {}, loginPage: false } }], "演示课程");
  assert.equal(missing.courseContext, false);
  const recognized = checker.aggregate([{ snapshot: { title: "演示课程", courseLabel: "演示课程", roles: { courseShell: true }, loginPage: false } }], "演示课程");
  assert.equal(recognized.courseContext, true);
  const wrongPage = checker.aggregate([{ snapshot: { title: "演示课程", roles: {}, loginPage: false } }], "演示课程");
  assert.equal(wrongPage.courseContext, true);
});

test("course list entries are matched by normalized course name", () => {
  const inspections = [
    { snapshot: { title: "个人空间", roles: {}, loginPage: false, courseList: [{ name: "其他课程", href: "https://mooc1-1.chaoxing.com/mooc-ans/coursecontroller/isNewCourse?courseId=1" }] } },
    { snapshot: { title: "自然语言处理", roles: {}, loginPage: false, courseList: [{ name: " 自然语言处理 ", href: "https://mooc1-1.chaoxing.com/mooc-ans/coursecontroller/isNewCourse?courseId=2" }] } },
  ];
  const entry = checker.findCourseListEntry(inspections, "自然语言处理");
  assert.equal(entry.href, "https://mooc1-1.chaoxing.com/mooc-ans/coursecontroller/isNewCourse?courseId=2");
  assert.equal(checker.findCourseListEntry(inspections, "不存在的课程"), undefined);
  assert.equal(checker.findCourseListEntry(inspections, ""), undefined);
});

test("aggregate exposes detectedCourseName and classNames for popup backfill", () => {
  const found = checker.aggregate([
    { snapshot: { title: "自然语言处理", courseLabel: "自然语言处理", roles: { courseShell: true }, loginPage: false } },
    { snapshot: { title: "班级", roles: { attendance: true }, loginPage: false, classNames: ["人工智能1班", "人工智能2班"] } },
    { snapshot: { title: "作业", roles: { assignment: true }, loginPage: false, classNames: ["人工智能1班"] } },
  ], "自然语言处理");
  assert.equal(found.acquisitionState, "采集到");
  assert.equal(found.detectedCourseName, "自然语言处理");
  assert.deepEqual(Array.from(found.classNames), ["人工智能1班", "人工智能2班"]);

  const emptyCourse = checker.aggregate([
    { snapshot: { title: "自然语言处理", courseLabel: "自然语言处理", roles: { courseShell: true }, loginPage: false } },
  ], "");
  assert.equal(emptyCourse.acquisitionState, "未获取");
  assert.equal(emptyCourse.detectedCourseName, undefined);
  assert.equal(emptyCourse.classNames, undefined);
});

test("findCourseShellSnapshot returns the first frame carrying a course identity", () => {
  const snapshots = [
    { title: "个人空间", roles: {}, loginPage: false },
    { title: "自然语言处理", courseLabel: "自然语言处理", roles: { courseShell: true }, loginPage: false },
    { title: "统计", courseLabel: "另一门课", roles: { statistics: true }, loginPage: false },
  ];
  const shell = checker.findCourseShellSnapshot(snapshots);
  assert.equal(shell.courseLabel, "自然语言处理");
  const statisticsOnly = checker.findCourseShellSnapshot([snapshots[2]]);
  assert.equal(statisticsOnly.courseLabel, "另一门课");
  assert.equal(checker.findCourseShellSnapshot([snapshots[0]]), undefined);
});
