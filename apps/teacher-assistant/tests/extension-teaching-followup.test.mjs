import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
const context = { Date, URL, TextEncoder, structuredClone, crypto: webcrypto, setTimeout, clearTimeout }; context.globalThis = context;
for (const name of ['grading-batch-core', 'teaching-followup-core']) vm.runInNewContext(readFileSync(new URL(`../extension/${name}.js`, import.meta.url), 'utf8'), context);
const F = context.LearningTongFollowup;
const scope = { kind: 'assignment', courseName: '课程甲', className: '甲班', workTitle: '任务甲', courseId: 'course-a', classId: 'class-a', workId: 'work-a', listUrl: 'https://mooc1.chaoxing.com/work/mark-list?courseid=course-a&clazzid=class-a&workid=work-a&status=3&submit=true' };
const at = F.timeOf('2026-10-09 12:00:00');
const student = changes => ({ studentName: '示例甲', studentNo: '001', status: '已交', submitTime: '2026-10-08 12:00:00', deadline: '2026-10-08 12:00:00', ...changes });
const analyze = (rows, options = {}, s = scope) => F.analyzeRoster(s, rows, { confirmed: true, complete: true, source: 'import', total: rows.length, at, ...options });
test('school timestamps are Beijing time independent of machine timezone', () => {
  assert.equal(F.timeOf('2026-10-09 12:00:00'), F.timeOf('2026-10-09T04:00:00Z'));
  assert.equal(F.timeOf('2026-10-09 12:00:00+08:00'), at);
  assert.equal(F.displayTime(at), '2026-10-09 12:00:00');
  assert.equal(F.deadlineOf('2026-10-08 12:00 ～ 2026-10-09 12:00'), '2026-10-09 12:00');
});
for (const value of ['2026-02-29 12:00', '2026-13-01 12:00', '2026-10-09 24:00', '2026-10-09', '2026-10-09 12:00+14:01', '12:00', '明天']) test(`invalid date refused: ${value}`, () => assert.equal(F.timeOf(value), null));
test('exact cutoff is ontime; later submitted is late; unsubmitted past cutoff is overdue', () => {
  const r = analyze([student(), student({ studentNo: '002', submitTime: '2026-10-08 12:00:01' }), student({ studentNo: '003', status: '未提交', submitTime: '' })]);
  assert.deepEqual(Array.from(r.entries, e => e.status), ['ontime', 'late', 'overdue']);
});
for (const [desc, changes, expected] of [
  ['missing cutoff cannot imply overdue', { status: '未交', submitTime: '', deadline: '' }, 'unsubmitted'],
  ['missing submit time cannot imply late', { submitTime: '' }, 'review'],
  ['future submit time needs review', { submitTime: '2026-10-10 12:00' }, 'review'],
  ['unsubmitted contradicting time', { status: '未交' }, 'review'],
  ['late label contradicting time', { status: '迟交' }, 'review'],
  ['missing identity', { studentNo: '' }, 'review'],
  ['unknown label', { status: '已阅' }, 'review'],
  ['exempt is not a reminder target', { status: '免交' }, 'exempt'],
]) test(desc, () => assert.equal(analyze([student(changes)]).entries[0].status, expected));
test('confirmed completeness and exact total are mandatory including zero rows', () => {
  assert.throws(() => analyze([student()], { confirmed: false }), /确认/);
  assert.throws(() => analyze([student()], { complete: false }), /确认/);
  assert.throws(() => analyze([student()], { total: 2 }), /总人数/);
  assert.equal(analyze([], { total: 0 }).total, 0);
  assert.throws(() => analyze([student()], { deadline: '无截止' }), /截止时间/);
});
test('duplicates and mixed class or task are refused rather than silently merged', () => {
  assert.throws(() => analyze([student(), student()]), /重复/);
  assert.throws(() => analyze([student({ courseName: '课程乙' })]), /其他课程/);
  assert.throws(() => analyze([student({ className: '乙班' })]), /其他班级/);
  assert.throws(() => analyze([student({ workTitle: '任务乙' })]), /其他作业/);
  assert.throws(() => analyze([student()], {}, { ...scope, className: '' }), /课程/);
});
test('sheet requires unambiguous identity/status columns and skips blank records', () => {
  const rows = F.fromSheet([['姓名', '学号', '提交状态', '提交时间'], ['示例甲', '001', '未交', ''], ['', '', '', '']]);
  assert.equal(rows.length, 1); assert.equal(rows[0].studentNo, '001');
  assert.throws(() => F.fromSheet([['姓名', '学号'], ['甲', '01']]), /提交状态/);
  assert.throws(() => F.fromSheet([['姓名', '学号', '状态', '提交状态'], ['甲', '01', '未交', '未交']]), /同义/);
});
test('export preserves text IDs and escapes spreadsheet formula injection', () => {
  const csv = F.rosterCsv(analyze([student({ status: '未交', submitTime: '', studentName: '=HYPERLINK("bad")', studentNo: '001' })]));
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"001"')); assert.ok(csv.includes("'=HYPERLINK")); assert.ok(!csv.includes('course-a'));
});
test('reminder counts only confirmed unsubmitted; no identity or late student list', () => {
  const report = analyze([student({ status: '未交', submitTime: '' }), student({ studentName: '迟交姓名', studentNo: '002', submitTime: '2026-10-08 14:00' }), student({ studentName: '未知姓名', studentNo: '003', status: '未知' })]);
  const text = F.reminder(report, '请于课堂上核对补交安排'); assert.match(text, /1人未交/);
  for (const id of ['示例甲', '迟交姓名', '未知姓名', '001', '002', 'course-a']) assert.ok(!text.includes(id));
  assert.match(text, /审核草稿/); assert.match(text, /请于课堂上/);
  assert.throws(() => F.reminder(analyze([student()])), /没有已确认/);
});
test('demo reminder remains visibly simulated', () => assert.match(F.reminder(analyze([student({ status: '未交', submitTime: '' })], { source: 'demo' })), /脱敏模拟/));
test('snapshots retain only aggregate task metadata', () => {
  const p = { acquisitionState: '采集到', signals: { crossFrameVerified: true }, reason: '已核验', pendingAssignments: [{ pending: 3, studentName: 'secret' }], assignmentDeadlines: [{ title: '任务', className: '甲班', deadline: '2026-10-09 13:00', studentNo: 'secret', url: 'private' }] };
  const saved = F.taskSnapshot({ name: scope.courseName, classNames: [scope.className], courseId: 'secret' }, p, at);
  assert.equal(saved.pending, 3); assert.ok(!JSON.stringify(saved).includes('secret')); assert.ok(!JSON.stringify(saved).includes('private'));
  assert.equal(F.taskSnapshot({}, undefined, at).state, '未获取');
  assert.equal(F.taskSnapshot({}, { ...p, signals: {} }, at).pending, null);
  assert.equal(F.taskSnapshot({}, { ...p, pendingAssignments: [{ pending: 'wrong' }] }, at).state, '未获取');
  assert.equal(F.taskSnapshot({}, { ...p, assignmentDeadlines: Array(1001).fill({}) }, at).state, '未获取');
});
test('missing or stale class scope never becomes zero pending', () => {
  const courses = [{ name: scope.courseName, classNames: [scope.className] }];
  const scans = { [scope.courseName]: { 'assignment-pending': { state: '确认无数据', pendingTotal: 0, at } } };
  assert.match(F.todos(courses, scans, [], at)[0].title, /未获取/);
  const snapshot = F.taskSnapshot(courses[0], { acquisitionState: '确认无数据', signals: { crossFrameVerified: true } }, at);
  assert.match(F.todos(courses, scans, [snapshot], at)[0].title, /上次扫描/);
  assert.match(F.todos([{ ...courses[0], classNames: ['乙班'] }], scans, [snapshot], at)[0].title, /未获取/);
});
test('deadline todo uses 72 hour window without inferring unsubmitted students', () => {
  const course = { name: scope.courseName, classNames: [scope.className] };
  const snapshot = F.taskSnapshot(course, { acquisitionState: '采集到', signals: { crossFrameVerified: true }, pendingAssignments: [{ pending: 1 }], assignmentDeadlines: [{ title: '临近', deadline: F.displayTime(at + 72 * 3600000) }, { title: '远期', deadline: F.displayTime(at + 73 * 3600000) }] }, at);
  const rows = F.todos([course, { ...course, archived: true }], {}, [snapshot], at);
  assert.equal(rows.filter(r => r.kind === 'deadline').length, 1); assert.match(rows.at(-1).reason, /不据此认定学生未交/);
});
function transport() {
  const data = {}, tabs = new Map([[1, { id: 1 }]]), messages = [], removed = []; let listener, nextId = 10;
  const store = { async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, structuredClone(data[k])])); }, async set(o) { Object.assign(data, structuredClone(o)); }, async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; } };
  const ctx = { ...context }; ctx.globalThis = ctx;
  ctx.chrome = { runtime: { id: 'test', getURL: p => `chrome-extension://test/${p}`, onMessage: { addListener: f => listener = f }, lastError: null }, storage: { session: store }, tabs: {
    create(o, cb) { const t = { id: nextId++, url: o.url, status: 'complete' }; tabs.set(t.id, t); cb(t); },
    update(id, o, cb) { tabs.set(id, { id, url: o.url, status: 'complete' }); cb(tabs.get(id)); },
    get(id, cb) { cb(tabs.get(id)); }, remove(id, cb) { removed.push(id); tabs.delete(id); cb(); },
    sendMessage(id, message, options, cb) { messages.push(message); cb(message.type === 'batch-page-discover' ? { ok: true, data: scope } : { ok: true, data: { rows: [], total: 0, totalPages: 1, completeFilter: true } }); },
  } };
  for (const path of ['content/grading-adapter-core.js', 'grading-batch-background.js']) vm.runInNewContext(readFileSync(new URL(`../extension/${path}`, import.meta.url), 'utf8'), ctx);
  const sender = { id: 'test', url: 'chrome-extension://test/workspace/workspace.html', tab: { id: 1 } };
  return { data, tabs, messages, removed, reload() { vm.runInNewContext(readFileSync(new URL('../extension/grading-batch-background.js', import.meta.url), 'utf8'), ctx); }, async send(message, from = sender) { const r = await new Promise(resolve => listener(message, from, resolve)); await new Promise(resolve => setImmediate(resolve)); return r; }, sender };
}
test('roster transport owns a read-only tab, uses all-status pages, survives worker restart and cleans up', async () => {
  const t = transport(); const r = await t.send({ type: 'batch-followup-start', scope, tabId: 2 }); assert.ok(r.ok, r.reason);
  const id = t.data[`followupScan:${r.id}`].platformTabId;
  let url = new URL(t.tabs.get(id).url); assert.equal(url.searchParams.get('status'), '0'); assert.ok(!url.searchParams.has('submit'));
  t.reload(); assert.ok((await t.send({ type: 'batch-followup-page', id: r.id, pageNumber: 2 })).ok);
  url = new URL(t.tabs.get(id).url); assert.equal(url.searchParams.get('pages'), '2'); assert.ok(!url.searchParams.has('submit'));
  assert.ok(t.messages.every(m => ['batch-page-discover', 'batch-page-roster'].includes(m.type)));
  assert.ok((await t.send({ type: 'batch-followup-finish', id: r.id })).ok); assert.ok(t.removed.includes(id)); assert.equal(t.data.followupActiveScan, undefined);
});
test('roster transport rejects foreign workspace, invalid page and stale source identity', async () => {
  const t = transport(); const r = await t.send({ type: 'batch-followup-start', scope, tabId: 2 });
  for (const pageNumber of [0, 1001, 1.5]) assert.equal((await t.send({ type: 'batch-followup-page', id: r.id, pageNumber })).ok, false);
  const foreign = { ...t.sender, tab: { id: 4 } }; t.tabs.set(4, { id: 4 });
  assert.equal((await t.send({ type: 'batch-followup-page', id: r.id, pageNumber: 1 }, foreign)).ok, false);
  assert.equal((await t.send({ type: 'batch-followup-finish', id: r.id }, foreign)).ok, false);
  assert.equal((await t.send({ type: 'batch-followup-start', scope, tabId: 2 }, foreign)).ok, false);
  assert.equal((await t.send({ type: 'batch-followup-start', scope: { ...scope, classId: 'other' }, tabId: 2 })).ok, false);
});
test('roster transport restricts entry to exact workspace sender', async () => {
  const t = transport(); assert.equal((await t.send({ type: 'batch-followup-start', scope, tabId: 2 }, { ...t.sender, url: 'https://mooc1.chaoxing.com/' })).ok, false); assert.equal(t.tabs.size, 1);
});
