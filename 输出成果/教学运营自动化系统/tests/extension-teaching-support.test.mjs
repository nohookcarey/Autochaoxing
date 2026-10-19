import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../extension/popup/teaching-support.js', import.meta.url), 'utf8'), ctx);
const api = ctx.LearningTongTeachingSupport;
const payload = { acquisitionState: '采集到', summary: { activeClass: '测试班', averageScore: 80, studentCount: 40, excellentCount: 24, passCount: 13, lowScoreCount: 3 } };
test('diagnosis uses aggregate evidence and labels limits', () => {
  const d = api.diagnose(payload); assert.equal(d.ok, true); assert.match(d.facts, /7.5%/); assert.match(d.limits, /不能证明/);
});
test('missing, empty, inconsistent and invalid numbers are not zero evidence', () => {
  assert.equal(api.diagnose({ ...payload, acquisitionState: '未获取' }).ok, false);
  for (const patch of [{ studentCount: 0 }, { passCount: 12 }, { averageScore: NaN }, { lowScoreCount: -1 }, { excellentCount: '24' }]) assert.equal(api.diagnose({ ...payload, summary: { ...payload.summary, ...patch } }).ok, false);
});
test('demo export and missing effects are explicitly distinguished', () => {
  const text = api.report({ diagnosis: api.diagnose(payload), demo: true });
  assert.match(text, /不是实际教学成效/); assert.match(text, /不能声称有效/); assert.match(text, /未经系统核验/);
});
test('templates preserve teacher judgment and do not invent attachment evidence', () => {
  assert.match(api.rubrics.nlp, /未读取附件不推断/); assert.match(api.rubrics.aigc, /待教师核验/);
});
