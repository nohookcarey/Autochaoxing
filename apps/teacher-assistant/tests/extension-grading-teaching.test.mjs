import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";

const ctx = { structuredClone, crypto: webcrypto, Date, TextEncoder }; ctx.globalThis = ctx;
for (const name of ["grading-batch-core", "grading-teaching-core"]) vm.runInNewContext(readFileSync(new URL(`../extension/${name}.js`, import.meta.url), "utf8"), ctx);
const B = ctx.LearningTongBatch, T = ctx.LearningTongTeaching;
function sample(count = 1) {
  const scope = { kind: "assignment", courseId: "private-course", classId: "private-class", workId: "private-task", courseName: "课程", className: "班级", workTitle: "任务" };
  const batch = B.createBatch(scope, Array.from({ length: count }, (_, n) => ({ identity: { ...scope, answerId: `private-${n}` }, status: "pending" })));
  const rubric = { dimensions: [{ name: "核验依据", maxScore: 100, criteria: "说明完整核验步骤" }] };
  for (const item of batch.items) item.snapshot = { identity: item.identity, complete: true, totalMax: 120, questions: [{ id: "private-question", automatic: false, maxScore: 100, question: "题目", studentAnswer: "私密学生原文", attachments: [{ href: "https://example.invalid/private" }] }, { id: "objective", automatic: true, maxScore: 20, existingScore: 19 }] };
  B.setRubrics(batch, { "private-question": rubric }); batch.references = { "private-question": "教师参考" };
  for (const item of batch.items) { item.suggestions = [{ questionId: "private-question", score: 80, dimensionScores: [{ name: "核验依据", score: 80 }], needsReview: false, evidence: "私密依据", comment: "私密评语" }]; item.originalSuggestions = structuredClone(item.suggestions); }
  return batch;
}
test("library persists only explicitly selected teacher standards and versions", () => {
  const batch = sample(); const t = T.templateFromBatch(batch, "实践量规", []);
  let library = T.appendTemplates([], [t]); library = T.appendTemplates(library, [t]);
  assert.deepEqual(Array.from(library, t => t.version), [1, 2]);
  const raw = T.exportLibrary(library); for (const text of ["private-", "studentAnswer", "私密学生", "私密评语", "https://", "identity"]) assert.ok(!raw.includes(text));
  assert.equal(T.importLibrary(raw).length, 2);
  assert.equal(T.mapTemplate(batch, library[1]).references["private-question"], "教师参考");
});
test("mapping follows order and score, never silently confirms, scales, or imports student identifiers", () => {
  const batch = sample(); const t = T.templateFromBatch(batch, "量规", []);
  batch.items[0].snapshot.questions[0].id = "new-q";
  const mapped = T.mapTemplate(batch, t); assert.equal(mapped.rubrics["new-q"].dimensions[0].maxScore, 100);
  assert.equal(batch.rubricVersion, 1); assert.equal(batch.items[0].selected, false);
  batch.items[0].snapshot.questions[0].maxScore = 50; assert.throws(() => T.mapTemplate(batch, t), /满分/);
});
for (const [name, mutate] of [
  ["student identity", t => t.studentName = "学生"], ["answer field", t => t.questions[0].studentAnswer = "答案"],
  ["credentials", t => t.questions[0].rubric.apiKey = "secret"], ["missing dimension", t => t.questions[0].rubric.dimensions = []],
  ["wrong total", t => t.questions[0].maxScore = 99], ["invalid version", t => t.version = 0], ["huge reference", t => t.questions[0].reference = "a".repeat(10001)],
]) test(`import rejects ${name}`, () => {
  const t = T.templateFromBatch(sample(), "量规", []); mutate(t);
  assert.throws(() => T.importLibrary(JSON.stringify({ format: "learningtong-rubrics-v1", templates: [t] })));
});
test("unconfirmed rubrics and exceeded library bounds are refused", () => {
  const batch = sample(); batch.rubricVersion = 0; assert.throws(() => T.templateFromBatch(batch, "量规", []), /确认/);
  const t = T.templateFromBatch(sample(), "量规", []); assert.throws(() => T.appendTemplates(Array.from({ length: 100 }, () => t), [t]), /100/);
  assert.throws(() => T.importLibrary("a".repeat(500001)), /500KB/);
  assert.throws(() => T.importLibrary('{"format":"learningtong-rubrics-v1","templates":[],"account":"secret"}'), /未知/);
});
test("calibration compares teacher to original AI subjective score without selecting or writing", () => {
  const batch = sample(); const item = batch.items[0]; item.suggestions[0].score = 90; item.suggestions[0].dimensionScores[0].score = 90;
  const c = T.recordCalibration(batch, item); assert.equal(c.teacher, 90); assert.equal(c.ai, 80); assert.equal(c.maxScore, 100);
  assert.equal(item.selected, false); assert.equal(item.approval, null);
  assert.equal(T.calibrationReport(batch).bias, 10); assert.match(T.calibrationReport(batch).direction, /偏严/);
  assert.equal(item.originalSuggestions[0].score, 80); assert.equal(item.snapshot.questions[1].existingScore, 19);
  assert.throws(() => B.submissionPlan(batch, item));
});
test("calibration reports signed bias and absolute error separately", () => {
  const batch = sample(2);
  batch.items[0].suggestions[0].score = 90; batch.items[0].suggestions[0].dimensionScores[0].score = 90;
  batch.items[1].suggestions[0].score = 70; batch.items[1].suggestions[0].dimensionScores[0].score = 70;
  batch.items.forEach(i => T.recordCalibration(batch, i));
  const r = T.calibrationReport(batch); assert.equal(r.count, 2); assert.equal(r.bias, 0); assert.equal(r.absolute, 10);
});
for (const field of ["studentAnswer", "rubric", "score", "material", "original"]) test(`calibration expires after ${field} changes`, () => {
  const batch = sample(), item = batch.items[0]; T.recordCalibration(batch, item);
  if (field === "studentAnswer") item.snapshot.questions[0].studentAnswer = "新答案";
  if (field === "rubric") batch.rubrics["private-question"].dimensions[0].criteria = "新标准";
  if (field === "score") item.suggestions[0].score = 81;
  if (field === "material") item.materialKeys = { key: "new-content" };
  if (field === "original") item.originalSuggestions[0].score = 81;
  assert.equal(T.calibrationReport(batch).count, 0);
});
test("calibration requires complete valid score dimensions and cannot alter verified or uncertain items", () => {
  const batch = sample(), item = batch.items[0]; item.suggestions[0].needsReview = true; assert.throws(() => T.recordCalibration(batch, item), /复核/);
  item.suggestions[0].needsReview = false;
  for (const state of [B.states.verified, B.states.uncertain, B.states.submitting]) { item.state = state; assert.throws(() => T.recordCalibration(batch, item)); }
});
test("lecture excludes unreviewed and stale answers and never quotes answer or identity fields", () => {
  const batch = sample(3); assert.throws(() => T.lecturePlan(batch), /审核/);
  B.confirmItem(batch, batch.items[0]); B.confirmItem(batch, batch.items[1]); batch.items[1].suggestions[0].score = 81;
  const text = T.lecturePlan(batch); assert.match(text, /1份已审核/); assert.match(text, /其余2份/); assert.match(text, /单例/);
  for (const forbidden of ["私密学生原文", "私密依据", "私密评语", "private-", "19分", "https://"]) assert.ok(!text.includes(forbidden));
  assert.match(text, /不是学生原文/); assert.match(text, /不代表全班/);
});
test("lecture combines repeated deductions and includes verified approvals but rejects invalidated rubric", () => {
  const batch = sample(2); for (const i of batch.items) B.confirmItem(batch, i);
  batch.items[0].state = B.states.verified; batch.items[0].selected = false;
  assert.match(T.lecturePlan(batch), /2\/2份/); const before = T.lectureKey(batch);
  batch.items[1].state = B.states.uncertain; assert.notEqual(T.lectureKey(batch), before);
  B.setRubrics(batch, batch.rubrics); assert.throws(() => T.lecturePlan(batch), /审核/);
  assert.equal(T.calibrationReport(batch).count, 0);
});
test("full-score reviewed answers do not invent common errors", () => {
  const batch = sample(), s = batch.items[0].suggestions[0]; s.score = 100; s.dimensionScores[0].score = 100;
  B.confirmItem(batch, batch.items[0]); assert.match(T.lecturePlan(batch), /没有依据生成共性错误/);
});
