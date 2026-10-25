import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadCore(relativePath) {
  const context = { globalThis: {} };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(new URL(relativePath, import.meta.url), "utf8"), context);
  return context.globalThis.LearningTongSheetFilling;
}

const ATTENDANCE_ROWS = [
  ["课程签到表"],
  ["序号", "姓名", "学号", "签到异常次数", "签到异常明细"],
  ["1", "张三", "20260910001", "", ""],
  ["2", "李四", "20260910002", "", ""],
  ["3", "王五", "20260910003", "", ""],
];

const SCORE_ROWS = [
  ["姓名", "学号", "平时成绩", "期末成绩"],
  ["张三", "20260910001", "80", ""],
  ["李四", "20260910002", "70", ""],
];

test("detectSheetStructure finds header, name, id and target columns", () => {
  const core = loadCore("../extension/popup/sheet-filling-core.js");
  const structure = core.detectSheetStructure(ATTENDANCE_ROWS, "attendance");
  assert.equal(structure.ok, true);
  assert.equal(structure.headerIndex, 1);
  assert.equal(structure.nameCol, 1);
  assert.equal(structure.idCol, 2);
  assert.equal(structure.countCol, 3);
  assert.equal(structure.detailCol, 4);
  assert.equal(structure.appendCols.length, 0);
  assert.equal(structure.dataRows.length, 3);
});

test("detectSheetStructure appends columns when attendance targets are missing", () => {
  const core = loadCore("../extension/popup/sheet-filling-core.js");
  const rows = [
    ["姓名", "学号"],
    ["张三", "20260910001"],
    ["李四", "20260910002"],
  ];
  const structure = core.detectSheetStructure(rows, "attendance");
  assert.equal(structure.ok, true);
  assert.equal(JSON.stringify(structure.appendCols.map((col) => col.kind)), JSON.stringify(["count", "detail"]));
});

test("detectSheetStructure scores mode prefers dedicated final-score column and skips averages", () => {
  const core = loadCore("../extension/popup/sheet-filling-core.js");
  const structure = core.detectSheetStructure(SCORE_ROWS, "score");
  assert.equal(structure.ok, true);
  assert.equal(structure.scoreCol, 3);
});

test("detectSheetStructure detects headerless rosters heuristically", () => {
  const core = loadCore("../extension/popup/sheet-filling-core.js");
  const rows = [
    ["张三", "20260910001"],
    ["李四", "20260910002"],
    ["王五", "20260910003"],
  ];
  const structure = core.detectSheetStructure(rows, "score");
  assert.equal(structure.ok, true);
  assert.equal(structure.noHeader, true);
  assert.equal(structure.headerIndex, -1);
  assert.equal(structure.nameCol, 0);
  assert.equal(structure.idCol, 1);
  assert.equal(structure.dataRows.length, 3);
  const match = core.matchStudents(rows, structure, [{ name: "张三", username: "20260910001", score: 88 }]);
  const plan = core.buildFillPlan(rows, structure, match, "score");
  assert.equal(plan.scoreCol, 2);
  assert.ok(plan.cells.every((cell) => cell.row >= 0));
  assert.equal(plan.cells.find((cell) => cell.row === 0 && cell.col === 2).value, 88);
});

test("detectSheetStructure rejects empty or ambiguous sheets", () => {
  const core = loadCore("../extension/popup/sheet-filling-core.js");
  assert.equal(core.detectSheetStructure([], "attendance").ok, false);
  const noHeader = [["标题", "备注"], ["说明", "内容"]];
  const result = core.detectSheetStructure(noHeader, "attendance");
  assert.equal(result.ok, false);
  assert.match(result.reason, /未找到学生名单表头/);
});

test("matchStudents matches by student id first and falls back to names", () => {
  const core = loadCore("../extension/popup/sheet-filling-core.js");
  const structure = core.detectSheetStructure(ATTENDANCE_ROWS, "attendance");
  const records = [
    { name: "张三", username: "20260910001", anomalyCount: 2, anomalySummary: "迟到×1、缺勤×1" },
    { name: "李四", username: "20260910002", anomalyCount: 0, anomalySummary: "" },
    { name: "赵六", username: "20260910099", anomalyCount: 1, anomalySummary: "迟到×1" },
  ];
  const match = core.matchStudents(ATTENDANCE_ROWS, structure, records);
  assert.equal(match.matches.length, 2);
  assert.equal(match.matches[0].matchBy, "学号");
  assert.equal(match.unmatchedRecords.length, 1);
  assert.equal(match.unmatchedRecords[0].name, "赵六");
  assert.equal(match.unmatchedRows, 1);
});

test("matchStudents marks duplicated names as unusable for name matching", () => {
  const core = loadCore("../extension/popup/sheet-filling-core.js");
  const rows = [
    ["姓名"],
    ["张三"],
    ["张三"],
  ];
  const structure = core.detectSheetStructure(rows, "attendance");
  const records = [
    { name: "张三", username: "20260910001", anomalyCount: 1, anomalySummary: "迟到×1" },
    { name: "张三", username: "20260910002", anomalyCount: 0, anomalySummary: "" },
  ];
  const match = core.matchStudents(rows, structure, records);
  assert.equal(match.matches.length, 0);
  assert.equal(JSON.stringify(match.duplicatedNames), JSON.stringify(["张三"]));
});

test("buildFillPlan fills anomaly counts and details for matched rows", () => {
  const core = loadCore("../extension/popup/sheet-filling-core.js");
  const structure = core.detectSheetStructure(ATTENDANCE_ROWS, "attendance");
  const records = [
    { name: "张三", username: "20260910001", anomalyCount: 2, anomalySummary: "迟到×1、缺勤×1" },
    { name: "李四", username: "20260910002", anomalyCount: 0, anomalySummary: "" },
  ];
  const match = core.matchStudents(ATTENDANCE_ROWS, structure, records);
  const plan = core.buildFillPlan(ATTENDANCE_ROWS, structure, match, "attendance");
  const cellAt = (row, col) => plan.cells.find((cell) => cell.row === row && cell.col === col);
  assert.equal(cellAt(2, 3).value, 2);
  assert.equal(cellAt(2, 3).numeric, true);
  assert.equal(cellAt(2, 4).value, "迟到×1、缺勤×1");
  assert.equal(cellAt(3, 3).value, 0);
  assert.equal(cellAt(3, 4).value, "无异常");
  assert.equal(cellAt(4, 3).value, "未匹配");
});

test("buildFillPlan appends score column headers when missing", () => {
  const core = loadCore("../extension/popup/sheet-filling-core.js");
  const rows = [
    ["姓名", "学号"],
    ["张三", "20260910001"],
  ];
  const structure = core.detectSheetStructure(rows, "score");
  const records = [{ name: "张三", username: "20260910001", score: 92.5 }];
  const match = core.matchStudents(rows, structure, records);
  const plan = core.buildFillPlan(rows, structure, match, "score");
  assert.equal(plan.scoreCol, 2);
  const headerCell = plan.cells.find((cell) => cell.row === 0 && cell.col === 2);
  assert.equal(headerCell.value, "综合成绩");
  const scoreCell = plan.cells.find((cell) => cell.row === 1 && cell.col === 2);
  assert.equal(scoreCell.value, 92.5);
  assert.equal(scoreCell.numeric, true);
});

test("buildFillPlan leaves unmatched rows untouched in score mode", () => {
  const core = loadCore("../extension/popup/sheet-filling-core.js");
  const structure = core.detectSheetStructure(SCORE_ROWS, "score");
  const records = [{ name: "张三", username: "20260910001", score: 95 }];
  const match = core.matchStudents(SCORE_ROWS, structure, records);
  const plan = core.buildFillPlan(SCORE_ROWS, structure, match, "score");
  const rowCells = plan.cells.filter((cell) => cell.row === 2);
  assert.equal(rowCells.length, 0);
  const scoreCell = plan.cells.find((cell) => cell.row === 1 && cell.col === 3);
  assert.equal(scoreCell.value, 95);
});
