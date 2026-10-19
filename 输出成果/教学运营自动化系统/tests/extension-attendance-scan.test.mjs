import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const context = { globalThis: {} };
vm.runInNewContext(readFileSync(resolve(process.cwd(), "extension/content/attendance-scan-core.js"), "utf8"), context);
const scanner = context.globalThis.LearningTongAttendanceScan;

test("attendance scanner accepts verified active and class list page roles", () => {
  assert.equal(scanner.attendancePageRole(
    "mobilelearn.chaoxing.com",
    "/page/active/activeList",
    "添加活动 活动类型 活动状态",
  ), "active-list");
  assert.equal(scanner.attendancePageRole(
    "mobilelearn.chaoxing.com",
    "/page/class/classList",
    "人工智能1班 学生人数 52 活动列表",
  ), "class-list");
  assert.equal(scanner.attendancePageRole(
    "mobilelearn.chaoxing.com",
    "/page/class/classList",
    "人工智能1班",
  ), "");
  assert.equal(scanner.attendancePageRole(
    "example.invalid",
    "/page/class/classList",
    "学生人数 活动列表",
  ), "");
});

test("attendance scanner accepts current and legacy class-list shapes", () => {
  assert.deepEqual(Array.from(scanner.extractClassArray({ data: [{ id: 1 }] }), (item) => item.id), [1]);
  assert.deepEqual(Array.from(scanner.extractClassArray({ data: { classArray: [{ id: 2 }] } }), (item) => item.id), [2]);
});

test("attendance scanner validates student identity before declaring a usable result", () => {
  const complete = scanner.summarizeClass({
    className: "演示3班",
    studentCount: 2,
    activities: [{ ok: true, data: {
      yiqianList: [{ username: "202401010001", status: 1 }],
      weiqianList: [{ username: "202401010002", status: 8 }],
    } }],
  });
  assert.equal(complete.complete, true);
  assert.equal(complete.anomalyRecordCount, 1);
  assert.equal(complete.statusCounts["事假"], 1);

  const missingId = scanner.summarizeClass({
    className: "演示4班",
    studentCount: 1,
    activities: [{ ok: true, data: { yiqianList: [], weiqianList: [{ username: "", status: 0 }] } }],
  });
  assert.equal(missingId.complete, false);
  assert.equal(missingId.invalidIdentityRows, 1);
  assert.equal(missingId.statusCounts["未签到"], 1);

  const unknown = scanner.summarizeClass({
    className: "演示6班",
    studentCount: 1,
    activities: [{ ok: true, data: { yiqianList: [], weiqianList: [{ username: "202401010003", status: 999 }] } }],
  });
  assert.equal(unknown.complete, false);
  assert.deepEqual(Array.from(unknown.unknownStatuses), ["999@weiqianList"]);
});

test("attendance aggregation returns 未获取 for partial student-level evidence", () => {
  const payload = scanner.aggregateClassSummaries([
    { complete: true, signActivityCount: 2, anomalyRecordCount: 1, invalidIdentityRows: 0, failedActivityCount: 0, unknownStatuses: [] },
    { complete: false, signActivityCount: 2, anomalyRecordCount: 3, invalidIdentityRows: 1, failedActivityCount: 0, unknownStatuses: [] },
  ], 2);
  assert.equal(payload.acquisitionState, "未获取");
  assert.equal(payload.partialScope, true);
  assert.match(payload.reason, /不可用于回填/);
});

test("collectClassStudents aggregates per-student anomalies across activities", () => {
  const result = scanner.collectClassStudents("演示3班", [
    { ok: true, data: {
      yiqianList: [
        { name: "张三", username: "202401010001", status: 9 },
        { name: "李四", username: "202401010002", status: 1 },
      ],
      weiqianList: [{ name: "王五", username: "202401010003", status: 0 }],
    } },
    { ok: true, data: {
      yiqianList: [],
      weiqianList: [
        { name: "张三", username: "202401010001", status: 5 },
        { name: "王五", username: "202401010003", status: 7 },
      ],
    } },
    { ok: false },
  ]);
  const byName = new Map(result.students.map((student) => [student.name, student]));
  assert.equal(result.className, "演示3班");
  assert.equal(byName.get("张三").anomalyCount, 2);
  assert.equal(byName.get("张三").anomalySummary, "迟到×1、缺勤×1");
  assert.equal(byName.get("李四").anomalyCount, 0);
  assert.equal(byName.get("李四").anomalySummary, "");
  assert.equal(byName.get("王五").anomalyCount, 2);
  assert.equal(byName.get("王五").anomalySummary, "未签到×1、病假×1");
});

test("collectClassStudents skips invalid identity rows", () => {
  const result = scanner.collectClassStudents("演示3班", [
    { ok: true, data: { yiqianList: [{ name: "未知", username: "abc", status: 9 }], weiqianList: [] } },
  ]);
  assert.equal(result.students.length, 0);
});
