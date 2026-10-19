import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";

const context = { console, structuredClone, crypto: webcrypto, TextEncoder, Date, URL, AbortController, setTimeout, clearTimeout, fetch };
context.globalThis = context;
for (const path of ["grading-batch-core.js", "grading-ai-client.js"]) vm.runInNewContext(readFileSync(new URL(`../extension/${path}`, import.meta.url), "utf8"), context);
const B = context.LearningTongBatch, AI = context.LearningTongBatchAi;
const scope = { courseName: "测试课程", className: "测试班", workTitle: "测试任务", courseId: "course-a", classId: "class-a", workId: "work-a", kind: "assignment", listUrl: "https://mooc1.chaoxing.com/work/mark-list" };
const rubric = { dimensions: [{ name: "内容", maxScore: 60, criteria: "概念与例子正确" }, { name: "核验", maxScore: 40, criteria: "给出核验方法" }] };
const suggestion = { questionId: "q-a", score: 80, dimensionScores: [{ name: "内容", score: 50 }, { name: "核验", score: 30 }], comment: "请完善核验依据", evidence: "答案写出了核验方法", needsReview: false };
function sample() {
  const identity = { ...scope, answerId: "answer-a" };
  const batch = B.createBatch(scope, [{ identity, status: "pending", reviewUrl: "https://mooc1.chaoxing.com/work/library/review-work" }]);
  const item = batch.items[0];
  item.snapshot = { identity, status: "pending", complete: true, totalMax: 100, questions: [{ id: "q-a", question: "说明概念并给出核验方法", studentAnswer: "概念说明与核验方法", referenceAnswer: "参考", maxScore: 100, automatic: false, attachments: [] }] };
  B.setRubrics(batch, { "q-a": rubric }); item.suggestions = structuredClone([suggestion]);
  return { batch, item };
}
test("cross-course/class/work and duplicate submission identities are rejected", () => {
  for (const field of ["courseId", "classId", "workId", "kind"]) assert.throws(() => B.createBatch(scope, [{ identity: { ...scope, answerId: "a", [field]: "different" }, status: "pending" }]), /不属于/);
  assert.throws(() => B.createBatch(scope, [1, 2].map(() => ({ identity: { ...scope, answerId: "same" }, status: "pending" }))), /重复/);
  assert.throws(() => B.identityKey({ ...scope }), /answerId/);
});
test("existing grades are skipped, unknown status stays manual and selection defaults off", () => {
  const batch = B.createBatch(scope, ["graded", "unknown", "pending"].map((status, n) => ({ identity: { ...scope, answerId: `a-${n}` }, status })));
  assert.deepEqual(Array.from(batch.items, i => i.state), [B.states.skipped, B.states.manual, B.states.pending]);
  assert.ok(batch.items.every(i => i.selected === false));
});
for (const [name, modify] of [
  ["missing dimension", r => r.dimensions.pop()], ["duplicate name", r => r.dimensions[1].name = "内容"], ["blank criteria", r => r.dimensions[0].criteria = ""], ["negative max", r => r.dimensions[0].maxScore = -1], ["wrong sum", r => r.dimensions[0].maxScore = 59],
]) test(`rubric rejects ${name}`, () => { const value = structuredClone(rubric); modify(value); assert.throws(() => B.validateRubric(value, 100)); });
for (const [name, modify] of [
  ["missing scores", s => s.dimensionScores.pop()], ["duplicate scores", s => s.dimensionScores[1].name = "内容"], ["unknown dimension", s => s.dimensionScores[0].name = "其他"], ["negative score", s => s.dimensionScores[0].score = -1], ["excess score", s => s.dimensionScores[0].score = 61], ["wrong total", s => s.score = 79], ["nan total", s => s.score = NaN], ["needs review", s => s.needsReview = true],
]) test(`grading rejects ${name}`, () => { const value = structuredClone(suggestion); modify(value); assert.throws(() => B.validateSuggestion(value, rubric, 100)); });
test("confirmation is required and edits invalidate the approval", () => {
  const { batch, item } = sample(); assert.throws(() => B.submissionPlan(batch, item));
  B.confirmItem(batch, item); assert.equal(B.submissionPlan(batch, item).total, 80); assert.equal(B.submissionPlan(batch, item).comment, null);
  item.suggestions[0].comment = "已修改"; assert.throws(() => B.submissionPlan(batch, item), /已变化/);
});
test("rubric changes clear suggestions, approvals and data consent", () => {
  const { batch, item } = sample(); B.confirmItem(batch, item); batch.consent = { provider: "test" };
  B.setRubrics(batch, { "q-a": rubric }); assert.equal(item.selected, false); assert.equal(item.approval, null); assert.equal(item.suggestions.length, 0); assert.equal(batch.consent, null);
});
for (const field of ["studentAnswer", "question", "referenceAnswer", "maxScore"]) test(`snapshot changes invalidate ${field}`, () => {
  const { batch, item } = sample(), fresh = structuredClone(item.snapshot); fresh.questions[0][field] = field === "maxScore" ? 99 : "内容已改变";
  assert.throws(() => B.assertSnapshot(batch, item, fresh), /变化/);
});
test("changing student or already-graded status cannot reuse a suggestion", () => {
  const { batch, item } = sample(), fresh = structuredClone(item.snapshot); fresh.identity.answerId = "other"; assert.throws(() => B.assertSnapshot(batch, item, fresh), /失效/);
  fresh.identity.answerId = item.identity.answerId; fresh.status = "graded"; assert.throws(() => B.assertSnapshot(batch, item, fresh));
});
test("multi-question totals preserve the platform's automatic score", () => {
  const { batch, item } = sample(); item.snapshot.questions.push({ id: "q-auto", question: "判断题", maxScore: 20, automatic: true, existingScore: 15 }); item.snapshot.totalMax = 120;
  B.assertSnapshot(batch, item, structuredClone(item.snapshot)); B.confirmItem(batch, item, true);
  const plan = B.submissionPlan(batch, item); assert.equal(plan.total, 95); assert.equal(plan.questions.length, 1); assert.match(plan.comment, /核验/);
});
test("interruption never retries a submission blindly", () => {
  const { batch, item } = sample(); item.state = B.states.submitting; item.selected = true; B.recover(batch);
  assert.equal(item.state, B.states.uncertain); assert.equal(item.selected, false); assert.throws(() => B.confirmItem(batch, item));
  item.state = B.states.generating; B.recover(batch); assert.equal(item.state, B.states.pending);
});
test("long answer and invalid objective scores are refused", () => {
  const { batch, item } = sample(); item.snapshot.questions[0].studentAnswer = "字".repeat(20001); assert.throws(() => B.assertSnapshot(batch, item, item.snapshot), /超限/);
  item.snapshot.questions[0].studentAnswer = "答案"; item.snapshot.questions[0].automatic = true; item.snapshot.questions[0].existingScore = null; assert.throws(() => B.assertSnapshot(batch, item, item.snapshot), /客观题/);
});
test("summary contains no answer, identity or individual score", () => {
  const { batch } = sample(), raw = JSON.stringify(B.summary(batch)); for (const forbidden of ["answer-a", "studentAnswer", "dimensionScores", "courseId", "score\""]) assert.ok(!raw.includes(forbidden));
});
test("AI payload does not contain identity fields and uses explicit image content", () => {
  const { item } = sample(); const q = { ...item.snapshot.questions[0], identity: item.identity, studentName: "不可发送姓名", studentAnswer: "姓名：示例 学号：abc 答案正文" };
  const messages = AI.messagesFor(q, rubric, [{ text: "附件正文", images: ["data:image/png;base64,test"] }]);
  const raw = JSON.stringify(messages); assert.ok(!raw.includes("不可发送姓名")); assert.ok(!raw.includes("answer-a")); assert.ok(!raw.includes("示例")); assert.ok(raw.includes("image_url"));
});
test("AI refuses empty, truncated and malformed score responses", async () => {
  assert.throws(() => AI.parse('{"score":100}'), /缺少/);
  assert.throws(() => AI.parse("无法评分"), /JSON/);
  const cfg = { baseUrl: "https://api.example.com/v1", apiKey: "test-key", model: "test" };
  await assert.rejects(AI.request(cfg, [], { fetcher: async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }) }) }), /截断/);
});
test("cancelled request does not retry or accept a late response", async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(AI.request({ baseUrl: "https://api.example.com", apiKey: "test", model: "model" }, [], { signal: controller.signal, fetcher: async (_u, o) => { calls++; if (o.signal.aborted) throw Object.assign(new Error("abort"), { name: "AbortError" }); } }), /取消/);
  assert.equal(calls, 1);
});

function transport() {
  const data = {}, pages = [], counters = { submit: 0, verifyScores: [] }; let listener;
  const store = { async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, structuredClone(data[k])])); }, async set(entries) { Object.assign(data, structuredClone(entries)); }, async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; } };
  const c = { ...context, loadAiConfig: async () => ({}), hasAiOriginPermission: async () => true };
  c.globalThis = c;
  c.chrome = { runtime: { id: "test-extension", getURL: p => `chrome-extension://test-extension/${p}`, lastError: null, onMessage: { addListener: fn => { listener = fn; } } }, storage: { session: store }, tabs: {
    update(id, options, cb) { pages.push(options.url); cb({ id }); }, get(id, cb) { cb({ id, status: "complete", url: pages.at(-1) }); },
    sendMessage(id, message, options, cb) {
      if (message.type === "batch-page-list") cb({ ok: true, data: { totalPages: 1, entries: [{ identity: sample().item.identity, status: "pending" }] } });
      else if (message.type === "batch-page-read") cb({ ok: true, data: sample().item.snapshot });
      else if (message.type === "batch-page-prepare") cb({ ok: true, data: { prepared: true } });
      else if (message.type === "batch-page-submit") { counters.submit++; cb({ ok: true, data: { dispatched: true } }); }
      else if (message.type === "batch-page-verify") { counters.verifyScores.push(message.score); cb({ ok: true, data: { verified: true, found: true, list: { totalPages: 1 } } }); }
    },
  } };
  vm.runInNewContext(readFileSync(new URL("../extension/content/grading-adapter-core.js", import.meta.url), "utf8"), c);
  vm.runInNewContext(readFileSync(new URL("../extension/grading-batch-background.js", import.meta.url), "utf8"), c);
  const sender = { id: "test-extension", url: "chrome-extension://test-extension/workspace/workspace.html", tab: { id: 1 } };
  return { data, counters, async seed(batch) { await store.set({ [`gradingBatch:${batch.id}`]: batch }); }, async send(message, from = sender) { const r = await new Promise(resolve => listener(message, from, resolve)); await new Promise(resolve => setImmediate(resolve)); return r; } };
}
test("platform writes require workspace sender, approval and a one-use token", async () => {
  const t = transport(), { batch, item } = sample(); batch.platformTabId = 2; batch.workspaceTabId = 1; await t.seed(batch);
  const untrusted = await t.send({ type: "batch-prepare-submit", id: batch.id, key: item.key }, { id: "test-extension", url: "https://mooc1.chaoxing.com/work" }); assert.equal(untrusted.ok, false);
  const noApproval = await t.send({ type: "batch-prepare-submit", id: batch.id, key: item.key }); assert.equal(noApproval.ok, false); assert.equal(t.counters.submit, 0);
  B.confirmItem(batch, item); await t.seed(batch);
  const p = await t.send({ type: "batch-prepare-submit", id: batch.id, key: item.key }); assert.equal(p.ok, true, p.reason);
  const r = await t.send({ type: "batch-submit", id: batch.id, token: p.token }); assert.equal(r.ok, true, r.reason); assert.equal(r.batch.items[0].state, B.states.uncertain);
  const twice = await t.send({ type: "batch-submit", id: batch.id, token: p.token }); assert.equal(twice.ok, false); assert.equal(t.counters.submit, 1);
  const verified = await t.send({ type: "batch-verify", id: batch.id, key: item.key }); assert.equal(verified.ok, true); assert.equal(verified.batch.items[0].state, B.states.verified);
});
test("other workspaces cannot operate the active batch", async () => {
  const t = transport(), { batch } = sample(); batch.workspaceTabId = 1; await t.seed(batch);
  const r = await t.send({ type: "batch-read", id: batch.id, key: batch.items[0].key }, { id: "test-extension", url: "chrome-extension://test-extension/workspace/workspace.html", tab: { id: 3 } }); assert.equal(r.ok, false); assert.match(r.reason, /另一个/);
});
test("material identity uses SHA-256 and detects byte changes", async () => {
  assert.equal((await B.materialDigest("attachment bytes")).length, 64);
  assert.notEqual(await B.materialDigest("attachment bytes"), await B.materialDigest("attachment changed"));
});
test("altered attachment evidence invalidates confirmation", () => {
  const { batch, item } = sample(); item.materialKeys = { "q-a": ["first"] }; B.confirmItem(batch, item);
  item.materialKeys["q-a"][0] = "changed"; assert.throws(() => B.submissionPlan(batch, item), /已变化/);
});
test("changing rubric must not relabel unread manual items as pending", () => {
  const { batch } = sample(); batch.items.push({ key: "unread", state: B.states.manual, snapshot: null, reason: "未获取答案" });
  B.setRubrics(batch, { "q-a": rubric }); assert.equal(batch.items[1].state, B.states.manual);
});

function reorderKeys(value) {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, reorderKeys(value[k])]));
  return value;
}
test('Chrome storage key reordering preserves scope and teacher approval', async () => {
  const t = transport(), {batch,item} = sample(); batch.workspaceTabId=1; batch.platformTabId=2;
  item.snapshot.questions[0].attachments=[{kind:'text',fileName:'材料.txt',href:'https://mooc1.chaoxing.com/a.txt'}];
  B.confirmItem(batch,item);
  const restored=reorderKeys(structuredClone(batch));
  assert.equal(B.snapshotKey(item.snapshot),B.snapshotKey(restored.items[0].snapshot));
  assert.equal(B.submissionPlan(restored,restored.items[0]).total,80);
  await t.seed(restored);
  assert.equal((await t.send({type:'batch-save',batch})).ok,true);
  for(const key of ['courseId','classId','workId']) {
    const changed=structuredClone(batch);changed.scope[key]='changed';
    assert.equal((await t.send({type:'batch-save',batch:changed})).ok,false);
  }
  item.state=B.states.verified;await t.seed(reorderKeys(batch));
  assert.equal((await t.send({type:'batch-save',batch})).ok,true);
  const changed=structuredClone(batch);changed.items[0].suggestions[0].score=100;
  assert.equal((await t.send({type:'batch-save',batch:changed})).ok,false);
});
test('Codex uses only fixed loopback and never retries an ambiguous failure',async()=>{
  const cfg={provider:'codex-local',baseUrl:'http://127.0.0.1:4175/v1',apiKey:'a'.repeat(64),model:'codex-default'};
  let calls=0;
  await assert.rejects(AI.request({...cfg,baseUrl:'http://example.com/v1'},[],{fetcher:async()=>{calls++;}}),/地址无效/);
  assert.equal(calls,0);
  await assert.rejects(AI.request(cfg,[{role:'user',content:'test'}],{fetcher:async(url,options)=>{calls++;assert.equal(url,cfg.baseUrl+'/chat/completions');assert.equal(JSON.parse(options.body).maxTokens,2600);throw new TypeError('offline');}}),/offline/);
  assert.equal(calls,1);
});

test('unread embedded materials block AI, teacher approval and submission even if complete is forged',async()=>{
 const {batch,item}=sample();const q=item.snapshot.questions[0];q.unresolvedMaterials=[{kind:'word',objectId:'sample-object',source:'https://mooc1.chaoxing.com/ananas/modules/attach/index.html'}];
 assert.throws(()=>B.assertSnapshot(batch,item,item.snapshot),/原文件未获取/);
 assert.throws(()=>B.confirmItem(batch,item),/材料读取未完成/);
 assert.throws(()=>AI.messagesFor(q,rubric,[]),/禁止生成评分/);
 const fresh=structuredClone(item.snapshot);fresh.questions[0].unresolvedMaterials[0].objectId='changed-object';
 assert.notEqual(B.snapshotKey(fresh),B.snapshotKey(item.snapshot));
 item.snapshot.complete=false;item.state=B.states.manual;B.setRubrics(batch,{'q-a':rubric});assert.equal(item.state,B.states.manual);
});
test('late AI response after cancellation is discarded',async()=>{
 const controller=new AbortController();
 await assert.rejects(AI.request({provider:'codex-local',baseUrl:'http://127.0.0.1:4175/v1',apiKey:'a'.repeat(64),model:'codex-default'},[],{signal:controller.signal,fetcher:async()=>{controller.abort();return{ok:true,json:async()=>({choices:[{message:{content:'LATE'},finish_reason:'stop'}]})};}}),/取消/);
});


test('independent readback uses the dispatched score after rubric changes and worker restart',async()=>{
 const t=transport(),{batch,item}=sample();batch.platformTabId=2;batch.workspaceTabId=1;B.confirmItem(batch,item);await t.seed(batch);
 const prepared=await t.send({type:'batch-prepare-submit',id:batch.id,key:item.key});assert.equal(prepared.ok,true,prepared.reason);
 const submitted=await t.send({type:'batch-submit',id:batch.id,token:prepared.token});assert.equal(submitted.ok,true,submitted.reason);assert.equal(submitted.batch.items[0].submittedPlan.total,80);
 B.setRubrics(submitted.batch,{'q-a':{dimensions:[{name:'新规则',maxScore:100,criteria:'新的教师标准'}]}});const restarted=transport();await restarted.seed(submitted.batch);
 const verified=await restarted.send({type:'batch-verify',id:batch.id,key:item.key});assert.equal(verified.ok,true,verified.reason);assert.equal(restarted.counters.verifyScores.at(-1),80);assert.equal(t.counters.submit,1);assert.equal(restarted.counters.submit,0);
});
