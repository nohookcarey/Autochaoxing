import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const context = { globalThis: {} };
vm.runInNewContext(readFileSync(resolve(process.cwd(), "extension/content/score-overview-scan-core.js"), "utf8"), context);
const scanner = context.globalThis.LearningTongScoreOverviewScan;

test("score overview parser returns only aggregate score fields", () => {
  const summary = scanner.parseSummary(`
    基础数据 学生成绩 演示2班 一键导出 设置分数段
    综合成绩平均分 82分
    100≥学生成绩≥80（32人） 80>学生成绩≥60（14人） 60>学生成绩≥0（4人）
    序号 姓名 学号 综合成绩
  `, ["演示1班", "演示2班"]);
  assert.equal(summary.activeClass, "演示2班");
  assert.equal(summary.averageScore, 82);
  assert.equal(summary.studentCount, 50);
  assert.equal(summary.complete, true);
  assert.equal(Object.hasOwn(summary, "students"), false);
});

test("score overview aggregation requires course and class scope", () => {
  const profile = { courseName: "演示课程", classNames: ["演示1班"] };
  const found = scanner.aggregate([
    { snapshot: { title: "演示课程", courseLabel: "演示课程", scoreRole: false } },
    { snapshot: { title: "学生成绩", scoreRole: true, summary: { activeClass: "演示1班", averageScore: 80, excellentCount: 20, passCount: 10, lowScoreCount: 0, studentCount: 30, complete: true } } },
  ], profile);
  assert.equal(found.acquisitionState, "采集到");
  assert.equal(found.signals.aggregateOnly, true);

  const wrongClass = scanner.aggregate([
    { snapshot: { title: "演示课程", courseLabel: "演示课程", scoreRole: false } },
    { snapshot: { title: "学生成绩", scoreRole: true, summary: { activeClass: "其他班", complete: true } } },
  ], profile);
  assert.equal(wrongClass.acquisitionState, "未获取");
  assert.match(wrongClass.reason, /白名单/);
});

test("parseStudentTable extracts students from a score page table", () => {
  const rows = [
    ["序号", "姓名", "学号", "平时成绩", "综合成绩"],
    ["1", "张三", "202401010001", "85", "91.5"],
    ["2", "李四", "202401010002", "70", "78"],
    ["平均", "", "", "77.5", "84.75"],
    ["3", "无效行", "short", "60", "60"],
  ];
  const parsed = scanner.parseStudentTable(rows);
  assert.equal(parsed.complete, true);
  assert.equal(parsed.students.length, 2);
  assert.equal(JSON.stringify(parsed.students[0]), JSON.stringify({ name: "张三", username: "202401010001", score: 91.5 }));
  assert.equal(JSON.stringify(parsed.students[1]), JSON.stringify({ name: "李四", username: "202401010002", score: 78 }));
});

test("parseStudentTable reports missing header or score column", () => {
  const noHeader = scanner.parseStudentTable([["姓名", "张三"], ["学号", "202401010001"]]);
  assert.equal(noHeader.complete, false);
  assert.match(noHeader.reason, /姓名\/学号/);
  const noScore = scanner.parseStudentTable([["姓名", "学号"], ["张三", "202401010001"]]);
  assert.equal(noScore.complete, false);
  assert.match(noScore.reason, /成绩列/);
  const empty = scanner.parseStudentTable([]);
  assert.equal(empty.complete, false);
});

test("parseStudentTable prefers composite score over other score columns", () => {
  const rows = [
    ["姓名", "学号", "成绩", "综合成绩"],
    ["张三", "202401010001", "85", "92"],
  ];
  const parsed = scanner.parseStudentTable(rows);
  assert.equal(parsed.students[0].score, 92);
});
