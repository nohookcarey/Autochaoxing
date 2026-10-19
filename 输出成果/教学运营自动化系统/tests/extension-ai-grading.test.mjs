import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const context = { globalThis: {}, Event: class Event { constructor(type) { this.type = type; } } };
vm.runInNewContext(readFileSync(resolve(process.cwd(), "extension/content/ai-grading-core.js"), "utf8"), context);
const core = context.globalThis.LearningTongAiGrading;

function buildDoc({ answer = "学生写的内容", reference = "参考答案内容", maxScore = "100.0" } = {}) {
  const elements = {
    "h2.mark_title": { innerText: "20260909 第五次课 演示作业" },
    ".mark_name": { innerText: "1. (简答题, 100分)\n\n把一则通知改得更清楚" },
    ".mark_answer_key": {
      innerText: `学生答案：\n${answer}\n\n正确答案：\n${reference}`,
    },
    "input.inputBranch.questionScore": { id: "score137019019", value: "", disabled: false, readOnly: false, dispatched: [] },
    'input[name^="qscore"]': { value: maxScore },
    'textarea[name="comment"]': { id: "comment56274396", value: "", dispatched: [] },
  };
  const dispatch = (el) => el.dispatchEvent?.({ type: "noop" }) ?? el.dispatched?.push("event");
  for (const el of Object.values(elements)) {
    if (el.dispatched) { el.dispatchEvent = (event) => el.dispatched.push(event.type); }
  }
  void dispatch;
  return {
    querySelector(selector) { return elements[selector] || null; },
    elements,
  };
}

test("normalizeConfig trims, strips trailing slashes and rejects non-https urls", () => {
  const normalized = core.normalizeConfig({ baseUrl: "https://api.deepseek.com/v1///", apiKey: "  sk-test  ", model: " deepseek-chat ", criteria: " 按要点给分 " });
  assert.equal(normalized.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(normalized.apiKey, "sk-test");
  assert.equal(normalized.model, "deepseek-chat");
  assert.equal(normalized.criteria, "按要点给分");
  assert.equal(core.normalizeConfig({ baseUrl: "http://insecure.example" }).baseUrl, core.DEFAULT_CONFIG.baseUrl);
});

test("configReady requires baseUrl, apiKey and model", () => {
  assert.equal(core.configReady({ apiKey: "sk-1" }), true);
  assert.equal(core.configReady({ apiKey: "" }), false);
});

test("extractGradingContext reads question, answer, reference and score inputs", () => {
  const doc = buildDoc();
  const contextValue = core.extractGradingContext(doc);
  assert.equal(contextValue.assignmentTitle, "20260909 第五次课 演示作业");
  assert.equal(contextValue.question, "1. (简答题, 100分) 把一则通知改得更清楚");
  assert.equal(contextValue.studentAnswer, "学生写的内容");
  assert.equal(contextValue.referenceAnswer, "参考答案内容");
  assert.equal(contextValue.maxScore, 100);
  assert.equal(contextValue.questionNumber, "1");
  assert.equal(contextValue.canGrade, true);
});

test("extractGradingContext flags attachment-only submissions as ungradable", () => {
  const doc = buildDoc({ answer: "" });
  const contextValue = core.extractGradingContext(doc);
  assert.equal(contextValue.canGrade, false);
  assert.match(core.describeSubmission(contextValue), /文档或图片附件/);
});

test("buildMessages contains question, answer, max score and criteria", () => {
  const messages = core.buildMessages({ assignmentTitle: "演示作业", question: "1. 简答题", studentAnswer: "答案", referenceAnswer: "参考", maxScore: 100, criteria: "按要点给分" });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /只输出一个 JSON 对象/);
  const payload = messages[1].content;
  for (const expected of ["演示作业", "1. 简答题", "答案", "参考", "100 分", "按要点给分"]) assert.ok(payload.includes(expected), `missing ${expected}`);
});

test("parseGradingResponse accepts plain, fenced and polluted JSON", () => {
  const plain = core.parseGradingResponse('{"score": 88, "comment": "不错"}');
  assert.equal(plain.ok, true);
  assert.equal(plain.score, 88);
  assert.equal(plain.comment, "不错");
  const fenced = core.parseGradingResponse("```json\n{\"score\": \"76.5\", \"comment\": \" 基本达标 \"}\n```");
  assert.equal(fenced.ok, true);
  assert.equal(fenced.score, 76.5);
  assert.equal(fenced.comment, "基本达标");
  const polluted = core.parseGradingResponse('评分结果如下：{"score": 95, "comment": "优秀"}，请核对。');
  assert.equal(polluted.score, 95);
});

test("parseGradingResponse clamps scores to the max and tolerates missing comments", () => {
  assert.equal(core.parseGradingResponse('{"score": 150, "comment": "超满分"}', 100).score, 100);
  assert.equal(core.parseGradingResponse('{"score": -5, "comment": "零分"}', 100).score, 0);
  const noComment = core.parseGradingResponse('{"score": 60}', 100);
  assert.equal(noComment.ok, true);
  assert.equal(noComment.score, 60);
  assert.match(noComment.comment, /手动补充/);
  const broken = core.parseGradingResponse("完全不是 JSON", 100);
  assert.equal(broken.ok, false);
  assert.match(broken.reason, /无法解析/);
});

test("applyGrading writes score and comment and dispatches input events", () => {
  const doc = buildDoc();
  const applied = core.applyGrading(doc, { ok: true, score: 85, comment: "结构完整，建议补充例子。" });
  assert.equal(applied, true);
  assert.equal(doc.elements["input.inputBranch.questionScore"].value, "85");
  assert.equal(doc.elements['textarea[name="comment"]'].value, "结构完整，建议补充例子。");
  assert.deepEqual(doc.elements["input.inputBranch.questionScore"].dispatched, ["input", "change"]);
  assert.deepEqual(doc.elements['textarea[name="comment"]'].dispatched, ["input"]);
});

test("applyGrading refuses read-only score inputs", () => {
  const doc = buildDoc();
  doc.elements["input.inputBranch.questionScore"].readOnly = true;
  assert.equal(core.applyGrading(doc, { ok: true, score: 85, comment: "x" }), false);
});

test("applyGrading rejects failed grading payloads", () => {
  const doc = buildDoc();
  assert.equal(core.applyGrading(doc, { ok: false, reason: "解析失败" }), false);
});

test("normalizeConfig keeps commentEnabled with a safe default", () => {
  assert.equal(core.normalizeConfig({}).commentEnabled, false);
  assert.equal(core.normalizeConfig({ commentEnabled: false }).commentEnabled, false);
  assert.equal(core.normalizeConfig({ commentEnabled: true }).commentEnabled, true);
  assert.equal(core.normalizeConfig({ commentEnabled: undefined }).commentEnabled, false);
});

test("buildMessages omits the comment requirement when comments are disabled", () => {
  const base = { assignmentTitle: "演示作业", question: "1. 简答题", studentAnswer: "答案", maxScore: 100 };
  const withComment = core.buildMessages({ ...base });
  assert.match(withComment[0].content, /"comment"/);
  const withoutComment = core.buildMessages({ ...base, commentEnabled: false });
  assert.doesNotMatch(withoutComment[0].content, /"comment"/);
  assert.match(withoutComment[0].content, /不要输出评语/);
  assert.equal(withoutComment[1].content, withComment[1].content);
});

test("parseGradingResponse accepts score-only payloads when comments are disabled", () => {
  const result = core.parseGradingResponse('{"score": 42}', 100, { commentRequired: false });
  assert.equal(result.ok, true);
  assert.equal(result.score, 42);
  assert.equal(result.comment, "");
  assert.equal(result.commentEnabled, false);
  const withRemark = core.parseGradingResponse('{"score": 42, "comment": "多余评语"}', 100, { commentRequired: false });
  assert.equal(withRemark.comment, "");
});

test("applyGrading leaves the comment box untouched when no comment is provided", () => {
  const doc = buildDoc();
  doc.elements['textarea[name="comment"]'].value = "教师已手写批语";
  const applied = core.applyGrading(doc, { ok: true, score: 90, comment: "", commentEnabled: false });
  assert.equal(applied, true);
  assert.equal(doc.elements["input.inputBranch.questionScore"].value, "90");
  assert.equal(doc.elements['textarea[name="comment"]'].value, "教师已手写批语");
  assert.deepEqual(doc.elements['textarea[name="comment"]'].dispatched, []);
});

test('Codex connection uses fixed loopback and cannot remember the local connection code',()=>{
 const config=core.normalizeConfig({provider:'codex-local',baseUrl:'http://evil.example/v1',apiKey:'a'.repeat(64),model:'',rememberKey:true});
 assert.equal(config.baseUrl,'http://127.0.0.1:4175/v1');assert.equal(config.model,'codex-default');assert.equal(config.rememberKey,false);
 assert.equal(core.normalizeConfig({baseUrl:'http://127.0.0.1:4175/v1'}).baseUrl,core.DEFAULT_CONFIG.baseUrl);
});


test("different attachments with the same displayed filename are all collected", () => {
  const links = ["https://mooc1.chaoxing.com/files/first.txt", "https://mooc1.chaoxing.com/files/second.txt", "https://mooc1.chaoxing.com/files/first.txt#preview"].map(href => ({textContent:"答案.txt 下载",getAttribute:() => href}));
  const attachments = core.collectAttachments({querySelector:()=>null,body:{querySelectorAll:()=>links}});
  assert.equal(attachments.length,2);
  assert.equal(attachments[0].fileName,attachments[1].fileName);
  assert.notEqual(attachments[0].href,attachments[1].href);
});
