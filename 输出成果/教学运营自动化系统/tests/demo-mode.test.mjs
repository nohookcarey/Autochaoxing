import assert from "node:assert/strict";
import test from "node:test";
import { buildArchitectureSvg, buildDemoReport, createDemoReadResult, createDemoWritePlan, createDemoWriteResult, demoCourseFor } from "../src/demo-mode.js";

test("demo mode produces deidentified read and controlled-write artifacts", () => {
  const course = demoCourseFor({ key: "aigc", name: "真实课程", classNames: ["真实班"] });
  assert.deepEqual(course.classNames, ["演示班 A", "演示班 B"]);
  const read = createDemoReadResult("scan", course);
  assert.equal(read.state, "已采集");
  assert.equal(createDemoReadResult("chapter-scan", course).state, "确认无数据");
  assert.equal(createDemoReadResult("attendance-scan", course).state, "已采集");
  assert.equal(createDemoReadResult("score", course).state, "待人工复核");
  const write = createDemoWriteResult(createDemoWritePlan("deadline", course));
  assert.equal(write.state, "演示回读通过");
  assert.deepEqual(write.classNames, ["演示班 A"]);
  assert.equal(write.rows[0][1], "2026-09-20 23:59");
  assert.equal(write.rows[1][1], "不变");
  const report = buildDemoReport([{ ...read, detail: read.summary }]);
  assert.equal(report.includes("Cookie"), true);
  assert.equal(report.includes("真实课程"), false);
  assert.equal(report.includes("真实班"), false);
  assert.equal(buildArchitectureSvg().includes("本机脱敏演示架构"), true);
});
