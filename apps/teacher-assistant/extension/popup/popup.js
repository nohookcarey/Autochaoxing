(() => {
const extensionApi = globalThis.chrome;
const scanCache = globalThis.LearningTongScanCache;
const STORE_KEY = "teachingOperationsExtension";
let teachingPayload = null;
let teachingDiagnosis = null;
const support = globalThis.LearningTongTeachingSupport;
function resetTeachingSupport() {
  teachingPayload = null; teachingDiagnosis = null;
  document.querySelector('#generate-teaching-support').disabled = true;
  document.querySelector('#teaching-support-result').replaceChildren();
  document.querySelector('#teaching-support-editor').hidden = true;
  for (const id of ['teaching-goal', 'teaching-implementation', 'teaching-observation']) document.getElementById(id).value = '';
}
const courseSelect = document.querySelector("#course-select");
const courseName = document.querySelector("#course-name");
const classNames = document.querySelector("#class-names");
const result = document.querySelector("#result");
const chatLog = document.querySelector("#chat-log");
const command = document.querySelector("#command");
const chapterTestPanel = document.querySelector("#chapter-test-panel");
const chapterTestScope = document.querySelector("#chapter-test-scope");
const attendancePanel = document.querySelector("#attendance-panel");
const attendanceScope = document.querySelector("#attendance-scope");
const courseOverviewPanel = document.querySelector("#course-overview-panel");
const scoreOverviewPanel = document.querySelector("#score-overview-panel");
const recentRuns = document.querySelector("#recent-runs");
const demoModeStatus = document.querySelector("#demo-mode-status");
const toggleDemoModeButton = document.querySelector("#toggle-demo-mode");
const archivedCoursesPanel = document.querySelector("#archived-courses-panel");
const archivedCourseCount = document.querySelector("#archived-course-count");
const archivedCourseList = document.querySelector("#archived-course-list");
const archiveCurrentCourseButton = document.querySelector("#archive-current-course");
const runFilter = document.querySelector("#run-filter");
const runHistorySummary = document.querySelector("#run-history-summary");
const deadlineForm = document.querySelector("#deadline-form");
const deadlineClass = document.querySelector("#deadline-class");
const deadlineTitle = document.querySelector("#deadline-title");
const deadlineTime = document.querySelector("#deadline-time");
const courseState = globalThis.LearningTongCourseState;
const runHistory = globalThis.LearningTongRunHistory;
const deadlineFormState = globalThis.LearningTongDeadlineForm;
const aiGrading = globalThis.LearningTongAiGrading;
const aiBaseUrl = document.querySelector("#ai-base-url");
const aiApiKey = document.querySelector("#ai-api-key");
const aiModel = document.querySelector("#ai-model");
const aiCriteria = document.querySelector("#ai-criteria");
const aiCommentEnabled = document.querySelector("#ai-comment-enabled");
const aiAttachmentEnabled = document.querySelector("#ai-attachment-enabled");
const aiConfigStatus = document.querySelector("#ai-config-status");
const defaultState = { courses: [{ id: "course-1", name: "", classNames: [], archived: false }], activeCourseId: "course-1", runs: [], demoMode: false, pendingDemoDeadline: undefined };
let state = structuredClone(defaultState);

if (!extensionApi?.storage?.local || !extensionApi?.runtime) {
  document.querySelectorAll("input, select, button").forEach((element) => { element.disabled = true; });
  result.replaceChildren();
  const title = document.createElement("strong"); title.textContent = "未获取"; result.append(title);
  const message = document.createElement("p"); message.textContent = "这是扩展源文件，不能直接打开。请在浏览器工具栏点击“教学运营助手（本机）”打开扩展。"; result.append(message);
  return;
}

function normalize(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function parseClasses(value) { return String(value || "").split(/[、,，\n]/).map(normalize).filter(Boolean); }
function activeCourse() { const active = courseState.activeCourses(state.courses); return active.find((course) => course.id === state.activeCourseId) || active[0]; }
function displayCourse(course = activeCourse()) { const index = Math.max(0, state.courses.findIndex((item) => item.id === course?.id)); return state.demoMode ? globalThis.LearningTongDemoMode.demoCourse(course, index) : course; }
async function save() { await extensionApi.storage.local.set({ [STORE_KEY]: state }); renderRecentRuns(); }
function statusText(payload) { return payload?.acquisitionState || "未获取"; }
function visibleRuns() { return state.runs.filter((run) => state.demoMode ? run.demo : !run.demo); }
function historyPayload(run) { return { acquisitionState: run.state || "未获取", reason: run.detail || "该任务没有保存更多原因；运行记录不包含学生明细。", view: "history" }; }
function renderRecentRuns() {
  recentRuns.replaceChildren();
  const visible = visibleRuns();
  const summary = runHistory.summarize(visible);
  runHistorySummary.textContent = `共 ${summary.total} 条 · 需处理 ${summary.attention} 条`;
  const runs = runHistory.filterRuns(visible, runFilter.value).slice(0, 20);
  if (!runs.length) { const empty = document.createElement("p"); empty.textContent = summary.total ? "该筛选下暂无记录。" : "暂无运行记录。"; recentRuns.append(empty); return; }
  runs.forEach((run) => { const item = document.createElement("button"); item.className = "recent-run-item"; item.type = "button"; item.setAttribute("aria-label", `回看 ${run.taskName}，状态 ${run.state}`); const title = document.createElement("strong"); title.textContent = `${run.taskName}｜${run.state}`; const meta = document.createElement("span"); meta.textContent = `${run.createdAt}｜${run.courseName}`; item.append(title, meta); item.addEventListener("click", () => renderResult(historyPayload(run))); recentRuns.append(item); });
}
function renderArchivedCourses() {
  const archived = courseState.archivedCourses(state.courses);
  archivedCoursesPanel.hidden = !archived.length;
  archivedCourseCount.textContent = String(archived.length);
  archivedCourseList.replaceChildren(...archived.map((course) => {
    const item = document.createElement("div"); item.className = "archived-course-item";
    const name = document.createElement("span"); name.textContent = displayCourse(course).name || "未命名课程";
    const actions = document.createElement("div"); actions.className = "archived-course-actions";
    const restore = document.createElement("button"); restore.className = "restore-course"; restore.type = "button"; restore.textContent = "恢复"; restore.disabled = state.demoMode; restore.dataset.courseId = course.id; restore.addEventListener("click", () => restoreArchivedCourse(course.id));
    const remove = document.createElement("button"); remove.className = "delete-course"; remove.type = "button"; remove.textContent = "删除"; remove.disabled = state.demoMode; remove.dataset.courseId = course.id; remove.title = "删除后不可恢复"; remove.addEventListener("click", () => deleteArchivedCourse(course.id));
    actions.append(restore, remove); item.append(name, actions); return item;
  }));
}
function renderDeadlineClasses() {
  const classes = displayCourse()?.classNames || [];
  const previous = deadlineClass.value;
  if (!classes.length) {
    const option = document.createElement("option"); option.value = ""; option.textContent = "请先保存班级白名单";
    deadlineClass.replaceChildren(option); deadlineClass.disabled = true; return;
  }
  deadlineClass.disabled = false;
  deadlineClass.replaceChildren(...classes.map((name) => { const option = document.createElement("option"); option.value = name; option.textContent = name; return option; }));
  deadlineClass.value = classes.includes(previous) ? previous : classes[0];
}
function renderCourses() {
  resetTeachingSupport();
  const active = activeCourse();
  const shown = displayCourse(active);
  const activeList = courseState.activeCourses(state.courses);
  courseSelect.replaceChildren(...activeList.map((course) => { const option = document.createElement("option"); option.value = course.id; option.textContent = displayCourse(course).name || "未命名课程"; return option; }));
  courseSelect.value = active.id; courseName.value = shown.name; classNames.value = shown.classNames.join("、");
  courseName.disabled = state.demoMode; classNames.disabled = state.demoMode; document.querySelector("#save-course").disabled = state.demoMode; document.querySelector("#new-course").disabled = state.demoMode; archiveCurrentCourseButton.disabled = state.demoMode || activeList.length <= 1;
  archiveCurrentCourseButton.title = activeList.length <= 1 ? "至少保留一门当前课程" : "归档后可在下方恢复";
  renderArchivedCourses();
  renderDeadlineClasses(); deadlineForm.hidden = true;
  document.body.classList.toggle("demo-active", state.demoMode); toggleDemoModeButton.textContent = state.demoMode ? "退出脱敏演示" : "开启脱敏演示"; demoModeStatus.textContent = state.demoMode ? "已启用：所有任务使用模拟课程和脱敏结果，不连接学习通。" : "脱敏演示不连接学习通，也不显示真实课程名称。";
  refreshCapabilities();
}
async function refreshCapabilities() {
  const active = activeCourse();
  const attendanceCard = document.querySelector("#fill-attendance-card");
  const scoreCard = document.querySelector("#fill-score-card");
  if (state.demoMode) {
    chapterTestPanel.hidden = false; chapterTestScope.textContent = "脱敏演示：2 个演示班级、4 个章节测试目标。";
    attendancePanel.hidden = false; attendanceScope.textContent = "脱敏演示：仅显示异常汇总，不含学生身份。";
    courseOverviewPanel.hidden = false; scoreOverviewPanel.hidden = false;
    if (attendanceCard) attendanceCard.hidden = false;
    if (scoreCard) scoreCard.hidden = false;
    return;
  }
  const capability = await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: "get-extension-capabilities", courseName: active?.name || "" }, (response) => resolve(response || {})));
  chapterTestPanel.hidden = !capability.chapterTests;
  if (capability.chapterTests) chapterTestScope.textContent = `只读扫描 ${capability.chapterTestCount} 个已验证测试；范围：${capability.chapterClassNames.join("、")}。`;
  attendancePanel.hidden = !capability.attendance;
  if (capability.attendance) attendanceScope.textContent = `只读扫描签到活动与异常；范围：${capability.attendanceClassNames.join("、")}。`;
  courseOverviewPanel.hidden = !capability.courseOverview;
  document.querySelector("#scan-chapter-structure").hidden = !capability.chapterStructure;
  scoreOverviewPanel.hidden = !capability.scoreOverview;
  if (attendanceCard) attendanceCard.hidden = !capability.attendance;
  if (scoreCard) scoreCard.hidden = !capability.scoreOverview;
}
const SCAN_META_IDS = { "assignment-pending": "#assignment-pending-meta", "assignment-deadlines": "#assignment-deadlines-meta", chapter: "#chapter-meta", attendance: "#attendance-meta", score: "#score-meta" };
const DEMO_VIEW_TASK_KEYS = { pending: "assignment-pending", deadlines: "assignment-deadlines", "chapter-tests": "chapter", attendance: "attendance", "score-overview": "score" };
function renderScanMeta(store) {
  const courseName = displayCourse().name;
  for (const [taskKey, selector] of Object.entries(SCAN_META_IDS)) {
    const node = document.querySelector(selector);
    if (!node) continue;
    const record = scanCache.lastScanOf(store, courseName, taskKey);
    if (!record) { node.textContent = ""; node.title = ""; continue; }
    const label = taskKey === "assignment-pending" ? "待批" : taskKey === "assignment-deadlines" ? "截止" : "";
    const time = scanCache.relativeTimeText(record.at);
    node.textContent = `${label}${label ? " " : ""}${time}${record.state === "采集到" ? "" : "（未完成）"}`;
    node.title = record.summary || "";
  }
}
function syncBadge(store) {
  if (!extensionApi.action?.setBadgeText) return;
  const record = scanCache.lastScanOf(store, displayCourse().name, "assignment-pending");
  const badge = record ? scanCache.badgeTextFor(record.pendingTotal) : "";
  extensionApi.action.setBadgeText({ text: badge });
  if (badge) extensionApi.action.setBadgeBackgroundColor({ color: "#b0413b" });
}
function storageGetLocal(keys) { return new Promise((resolve) => extensionApi.storage.local.get(keys, (stored) => resolve(stored || {}))); }
async function refreshScanMeta() {
  if (!scanCache) return;
  const stored = await storageGetLocal([scanCache.STORE_KEY]);
  const store = stored[scanCache.STORE_KEY];
  renderScanMeta(store);
  syncBadge(store);
}
async function recordLocalScan(taskKey, payload) {
  if (!scanCache || !taskKey || !payload?.acquisitionState) return;
  const summary = scanCache.scanSummaryFor(taskKey, payload);
  const stored = await storageGetLocal([scanCache.STORE_KEY]);
  const next = scanCache.mergeLastScan(stored[scanCache.STORE_KEY], {
    courseName: displayCourse().name,
    taskKey,
    at: Date.now(),
    state: payload.acquisitionState,
    summary,
    ...(taskKey === "assignment-pending" ? { pendingTotal: scanCache.pendingTotalOf(payload) } : {}),
  });
  await extensionApi.storage.local.set({ [scanCache.STORE_KEY]: next });
  renderScanMeta(next);
  syncBadge(next);
}
function scheduleScanMetaRefresh() { setTimeout(() => refreshScanMeta().catch(() => {}), 400); }
function renderResult(payload) {
  if (payload?.view === 'score-overview') {
    // Invalidate previous evidence even when a new scan fails.
    teachingPayload = support.diagnose(payload).ok ? structuredClone(payload) : null;
    teachingDiagnosis = null;
    document.querySelector('#generate-teaching-support').disabled = !teachingPayload;
    document.querySelector('#teaching-support-result').replaceChildren();
    document.querySelector('#teaching-support-editor').hidden = true;
  }
  result.replaceChildren(); const title = document.createElement("strong"); title.textContent = statusText(payload); result.append(title);
  const reason = document.createElement("p"); reason.textContent = payload?.reason || "未返回原因。"; result.append(reason);
  if (Number.isFinite(payload?.assignmentTotal)) { const total = document.createElement("p"); total.textContent = `已汇总 ${payload.assignmentTotal} 个作业，覆盖 ${payload.scannedPages?.length || 1} 个分页。`; result.append(total); }
  if (payload?.view === "deadlines" && payload.assignmentDeadlines?.length) { const appendDeadlines = (container, items) => { const list = document.createElement("ul"); items.forEach((item) => { const line = document.createElement("li"); line.textContent = `${item.className}｜${item.title}｜${item.deadline}`; list.append(line); }); container.append(list); }; const visibleItems = payload.assignmentDeadlines.slice(0, 8); appendDeadlines(result, visibleItems); const remaining = payload.assignmentDeadlines.slice(8); if (remaining.length) { const details = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = `展开其余 ${remaining.length} 项`; details.append(summary); appendDeadlines(details, remaining); result.append(details); } }
  else if (payload?.view === "chapter-tests" && payload.classSummary?.length) { const list = document.createElement("ul"); payload.classSummary.forEach((item) => { const line = document.createElement("li"); const details = item.pendingTests?.map((test) => `${test.num}（${test.pending}）`).join("、"); line.textContent = `${item.className}：${item.pendingTotal} 项待批，已扫描 ${item.testCount} 个测试${details ? `；${details}` : ""}`; list.append(line); }); result.append(list); }
  else if (payload?.view === "attendance" && payload.classSummary?.length) { const list = document.createElement("ul"); payload.classSummary.forEach((item) => { const line = document.createElement("li"); const statusDetail = Object.entries(item.statusCounts || {}).map(([name, count]) => `${name}${count}`).join("、"); const gate = item.complete ? "已验证" : `未获取（缺学号 ${item.invalidIdentityRows} 条）`; line.textContent = `${item.className}：${item.signActivityCount} 个签到，${item.anomalyRecordCount} 条异常，${gate}${statusDetail ? `；${statusDetail}` : ""}`; list.append(line); }); result.append(list); }
  else if (payload?.view === "course-overview" && payload.metrics) { const order = ["classCount", "studentCount", "chapterResourceCount", "materialResourceCount", "questionBankCount", "createdAssignmentCount", "publishedAssignmentCount", "submittedAssignmentCount", "createdPaperCount", "publishedExamCount", "submittedExamCount", "publishedChapterTestCount", "completedChapterTestCount", "courseActivityCount", "coursePageViews"]; const list = document.createElement("ul"); order.map((key) => payload.metrics[key]).filter(Boolean).forEach((item) => { const line = document.createElement("li"); line.textContent = `${item.label}：${Number(item.value).toLocaleString("zh-CN")} ${item.unit}`; list.append(line); }); result.append(list); }
  else if (payload?.view === "score-overview" && payload.summary) { const list = document.createElement("ul"); [["当前班级", payload.summary.activeClass], ["综合成绩平均分", `${payload.summary.averageScore} 分`], ["80—100 分", `${payload.summary.excellentCount} 人`], ["60—79.99 分", `${payload.summary.passCount} 人`], ["0—59.99 分", `${payload.summary.lowScoreCount} 人`], ["汇总人数", `${payload.summary.studentCount} 人`]].forEach(([label, value]) => { const line = document.createElement("li"); line.textContent = `${label}：${value}`; list.append(line); }); result.append(list); }
  else if (payload?.view === "chapter-structure" && payload.summary) { const totals = document.createElement("p"); totals.textContent = `${payload.summary.chapterCount} 个一级章节，${payload.summary.sectionCount} 个小节，${payload.summary.taskPointCount} 个任务点；开放 ${payload.summary.openCount} 个，未开放 ${payload.summary.closedCount} 个。`; result.append(totals); const list = document.createElement("ul"); payload.summary.chapters.forEach((item) => { const line = document.createElement("li"); line.textContent = `${item.title}：${item.sectionCount} 个小节，${item.taskPointCount} 个任务点`; list.append(line); }); result.append(list); }
  else if (payload?.view === "connection" && payload.roleLabels?.length) { const list = document.createElement("ul"); payload.roleLabels.forEach((label) => { const line = document.createElement("li"); line.textContent = `已识别：${label}`; list.append(line); }); if (payload.detectedCourseName) { const line = document.createElement("li"); line.textContent = `课程名称：${payload.detectedCourseName}`; list.append(line); } if (payload.classNames?.length) { const line = document.createElement("li"); line.textContent = `班级白名单候选：${payload.classNames.length} 个班级（${payload.classNames.slice(0, 6).join("、")}${payload.classNames.length > 6 ? "…" : ""}）`; list.append(line); } result.append(list); }
  else if (payload?.view === "connection" && payload.discoveredCourses?.length) { const list = document.createElement("ul"); payload.discoveredCourses.slice(0, 10).forEach((name) => { const line = document.createElement("li"); line.textContent = name; list.append(line); }); if (payload.discoveredCourses.length > 10) { const line = document.createElement("li"); line.textContent = `…共 ${payload.discoveredCourses.length} 门课程`; list.append(line); } result.append(list); }
  else if (payload?.view === "deadline-update-preview" && payload.preview && payload.confirmationToken) {
    const card = document.createElement("div"); card.className = "confirm-card";
    const scope = document.createElement("p"); scope.textContent = `${payload.preview.className}｜${payload.preview.title}`; card.append(scope);
    const change = document.createElement("p"); change.textContent = `${payload.preview.beforeEndTime} → ${payload.preview.nextEndTime}`; card.append(change);
    const actions = document.createElement("div"); actions.className = "confirm-actions";
    const confirm = document.createElement("button"); confirm.className = "danger-action"; confirm.type = "button"; confirm.textContent = "确认修改这一条"; confirm.addEventListener("click", () => confirmDeadlineUpdate(payload.confirmationToken));
    const cancel = document.createElement("button"); cancel.className = "cancel-action"; cancel.type = "button"; cancel.textContent = "暂不修改"; cancel.addEventListener("click", () => cancelDeadlineUpdate(payload.confirmationToken));
    actions.append(confirm, cancel); card.append(actions); result.append(card);
  }
  else if (payload?.classSummary?.length) { const list = document.createElement("ul"); payload.classSummary.forEach((item) => { const line = document.createElement("li"); line.textContent = `${item.className}：${item.pendingTotal} 项待批，${item.assignmentCount} 个作业`; list.append(line); }); result.append(list); }
}
function addChat(role, text) { const item = document.createElement("p"); item.className = `chat-${role}`; item.textContent = text; chatLog.append(item); chatLog.scrollTop = chatLog.scrollHeight; }
function resetChatForMode() { chatLog.replaceChildren(); const item = document.createElement("p"); item.textContent = state.demoMode ? "脱敏演示已开启。可使用按钮，或输入“扫描待批作业”“读取成绩概览”“把演示班 A 的作业《演示任务一》截止时间改为 2026-09-08 23:59”。" : "例如：扫描待批作业、查看截止时间或读取成绩概览。未接入的写入请求不会执行。"; chatLog.append(item); }
function createRun(payload, taskName) { return { id: crypto.randomUUID(), createdAt: new Date().toLocaleString("zh-CN", { hour12: false }), taskName, courseName: displayCourse().name || "未命名课程", state: statusText(payload), detail: payload.reason || "", demo: state.demoMode }; }
async function runDemo(view, taskName) { const payload = globalThis.LearningTongDemoMode.result(view); payload.view = view; renderResult(payload); state.runs = [createRun(payload, taskName), ...state.runs].slice(0, 100); await save(); recordLocalScan(DEMO_VIEW_TASK_KEYS[view], payload).catch(() => {}); return payload; }
function setButtonBusy(button, busy, busyText) {
  if (!button) return;
  if (busy) { button.dataset.originalLabel = button.textContent; button.dataset.originalDisabled = String(button.disabled); button.textContent = busyText; button.disabled = true; }
  else { button.textContent = button.dataset.originalLabel || button.textContent; button.disabled = button.dataset.originalDisabled === "true"; }
}
function showResultToUser(payload) { renderResult(payload); result.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
async function scan(view = "pending", button) {
  if (state.demoMode) return runDemo(view, view === "deadlines" ? "作业截止时间清单" : "作业待批扫描");
  const deadlines = view === "deadlines";
  const taskLabel = deadlines ? "作业截止时间清单" : "作业待批扫描";
  const profile = activeCourse();
  if (!profile.name || !profile.classNames.length) {
    const payload = { acquisitionState: "未获取", reason: "请先保存课程名称和班级白名单。" };
    showResultToUser(payload);
    return payload;
  }
  setButtonBusy(button, true, deadlines ? "正在采集…" : "正在扫描…");
  showResultToUser({ acquisitionState: "正在扫描", reason: deadlines ? "正在采集作业截止时间…" : "正在核验当前学习通教师作业页面…" });
  const payload = await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: deadlines ? "scan-active-assignment-deadlines" : "scan-active-assignment-page", profile: { courseName: profile.name, classNames: profile.classNames } }, (response) => resolve(response || { acquisitionState: "未获取", reason: "扩展未收到扫描结果。" })));
  setButtonBusy(button, false);
  payload.view = view; showResultToUser(payload); state.runs = [createRun(payload, taskLabel), ...state.runs].slice(0, 50); await save(); scheduleScanMetaRefresh();
  return payload;
}
async function scanChapterTests() {
  if (state.demoMode) return runDemo("chapter-tests", "章节测试待批审计");
  const profile = activeCourse();
  if (!profile.name) { const payload = { acquisitionState: "未获取", reason: "请先选择并保存课程。" }; renderResult(payload); return payload; }
  renderResult({ acquisitionState: "正在扫描", reason: "正在核验课程主页、章节页与章节测试待批列表…" });
  const payload = await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: "scan-active-chapter-tests", courseName: profile.name }, (response) => resolve(response || { acquisitionState: "未获取", reason: "扩展未收到章节测试扫描结果。" })));
  payload.view = "chapter-tests"; renderResult(payload); state.runs = [createRun(payload, "章节测试待批审计"), ...state.runs].slice(0, 50); await save(); scheduleScanMetaRefresh(); return payload;
}
async function scanAttendance() {
  if (state.demoMode) return runDemo("attendance", "签到活动与异常审计");
  const profile = activeCourse();
  if (!profile.name) { const payload = { acquisitionState: "未获取", reason: "请先选择并保存课程。" }; renderResult(payload); return payload; }
  renderResult({ acquisitionState: "正在扫描", reason: "正在核验班级活动页、签到活动和学生级状态门禁…" });
  const payload = await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: "scan-active-attendance", courseName: profile.name }, (response) => resolve(response || { acquisitionState: "未获取", reason: "扩展未收到签到扫描结果。" })));
  payload.view = "attendance"; renderResult(payload); state.runs = [createRun(payload, "签到活动与异常审计"), ...state.runs].slice(0, 50); await save(); scheduleScanMetaRefresh(); return payload;
}
async function scanCourseOverview() {
  if (state.demoMode) return runDemo("course-overview", "课程聚合概览");
  const profile = activeCourse();
  if (!profile.name) { const payload = { acquisitionState: "未获取", reason: "请先选择并保存课程。" }; renderResult(payload); return payload; }
  renderResult({ acquisitionState: "正在读取", reason: "正在核验课程统计页与基础数据页…" });
  const payload = await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: "scan-active-course-overview", courseName: profile.name }, (response) => resolve(response || { acquisitionState: "未获取", reason: "扩展未收到课程概览结果。" })));
  payload.view = "course-overview"; renderResult(payload); state.runs = [createRun(payload, "课程聚合概览"), ...state.runs].slice(0, 50); await save(); return payload;
}
async function scanScoreOverview() {
  resetTeachingSupport();
  if (state.demoMode) return runDemo("score-overview", "班级成绩聚合概览");
  const profile = activeCourse();
  if (!profile.name || !profile.classNames.length) { const payload = { acquisitionState: "未获取", reason: "请先保存课程名称和班级白名单。" }; renderResult(payload); return payload; }
  renderResult({ acquisitionState: "正在读取", reason: "正在核验课程、成绩页和当前班级范围…" });
  const payload = await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: "scan-active-score-overview", profile: { courseName: profile.name, classNames: profile.classNames } }, (response) => resolve(response || { acquisitionState: "未获取", reason: "扩展未收到成绩概览结果。" })));
  payload.view = "score-overview"; renderResult(payload); state.runs = [createRun(payload, "班级成绩聚合概览"), ...state.runs].slice(0, 50); await save(); scheduleScanMetaRefresh(); return payload;
}
async function scanChapterStructure() {
  if (state.demoMode) return runDemo("chapter-structure", "章节结构只读检查");
  const profile = activeCourse();
  if (!profile.name) { const payload = { acquisitionState: "未获取", reason: "请先选择并保存课程。" }; renderResult(payload); return payload; }
  renderResult({ acquisitionState: "正在检查", reason: "正在核验课程章节页和章节树…" });
  const payload = await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: "scan-active-chapter-structure", courseName: profile.name }, (response) => resolve(response || { acquisitionState: "未获取", reason: "扩展未收到章节结构结果。" })));
  payload.view = "chapter-structure"; renderResult(payload); state.runs = [createRun(payload, "章节结构只读检查"), ...state.runs].slice(0, 50); await save(); return payload;
}
async function applyDiscoveredCourse(payload) {
  if (state.demoMode || payload?.acquisitionState !== "采集到") return;
  const active = activeCourse();
  if (!active) return;
  const discoveredName = normalize(payload.detectedCourseName);
  const discoveredClasses = (payload.classNames || []).map(normalize).filter(Boolean);
  const emptyName = !normalize(courseName.value);
  const emptyClasses = !parseClasses(classNames.value).length;
  const updates = [];
  if (emptyName && discoveredName) { active.name = discoveredName; updates.push(`课程名称“${discoveredName}”`); }
  if (emptyClasses && discoveredClasses.length) { active.classNames = discoveredClasses; updates.push(`班级白名单 ${discoveredClasses.length} 个班级`); }
  if (!updates.length) return;
  await save();
  renderCourses();
}
async function checkConnection() {
  if (state.demoMode) return runDemo("connection", "课程连接检测");
  const profile = activeCourse();
  renderResult({ acquisitionState: "正在检测", reason: profile.name ? "正在核验课程名称、教师登录态和当前业务页面…" : "课程名称为空，正在自动识别当前学习通课程并回填…" });
  const payload = await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: "check-active-connection", courseName: profile.name }, (response) => resolve(response || { acquisitionState: "未获取", reason: "扩展未收到连接检测结果。" })));
  payload.view = "connection";
  await applyDiscoveredCourse(payload);
  renderResult(payload); state.runs = [createRun(payload, "课程连接检测"), ...state.runs].slice(0, 50); await save(); return payload;
}
async function prepareDeadlineUpdate(request) {
  if (state.demoMode) {
    const payload = globalThis.LearningTongDemoMode.deadlinePreview(request); payload.view = "deadline-update-preview"; state.pendingDemoDeadline = { token: payload.confirmationToken, request, createdAt: Date.now() }; renderResult(payload); state.runs = [createRun(payload, "作业截止时间修改预演"), ...state.runs].slice(0, 100); await save(); return payload;
  }
  renderResult({ acquisitionState: "正在预演", reason: "正在全分页唯一定位作业并读取原截止时间；此步骤不会提交修改。" });
  const payload = await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: "prepare-assignment-deadline-update", request }, (response) => resolve(response || { acquisitionState: "未获取", reason: "扩展未收到改期预演结果。" })));
  payload.view = "deadline-update-preview"; renderResult(payload); state.runs = [createRun(payload, "作业截止时间修改预演"), ...state.runs].slice(0, 50); await save(); return payload;
}
function toggleDeadlineForm(forceOpen) {
  const open = typeof forceOpen === "boolean" ? forceOpen : deadlineForm.hidden;
  deadlineForm.hidden = !open;
  if (open) { renderDeadlineClasses(); deadlineTitle.focus(); }
}
async function previewDeadlineFromForm() {
  const request = deadlineFormState.buildRequest(displayCourse(), deadlineClass.value, deadlineTitle.value, deadlineTime.value);
  if (!request.ok) { renderResult({ acquisitionState: "未获取", reason: request.reason }); return request; }
  const payload = await prepareDeadlineUpdate(request);
  if (payload.acquisitionState === "待确认") deadlineForm.hidden = true;
  return payload;
}
async function confirmDeadlineUpdate(confirmationToken) {
  if (String(confirmationToken).startsWith("demo:")) {
    const pending = state.pendingDemoDeadline; state.pendingDemoDeadline = undefined;
    const payload = pending?.token === confirmationToken && Date.now() - pending.createdAt <= 5 * 60 * 1000 ? globalThis.LearningTongDemoMode.deadlineResult(pending.request) : { acquisitionState: "未获取", reason: "演示确认已失效，请重新生成预览。" };
    renderResult(payload); state.runs = [createRun(payload, "单条作业截止时间修改"), ...state.runs].slice(0, 100); await save(); return payload;
  }
  renderResult({ acquisitionState: "正在提交", reason: "正在修改唯一目标并等待平台列表回读；不会自动重试。" });
  const payload = await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: "confirm-assignment-deadline-update", confirmationToken }, (response) => resolve(response || { acquisitionState: "未获取", reason: "扩展未收到提交结果。" })));
  renderResult(payload); state.runs = [createRun(payload, "单条作业截止时间修改"), ...state.runs].slice(0, 50); await save(); return payload;
}
async function cancelDeadlineUpdate(confirmationToken) {
  if (String(confirmationToken).startsWith("demo:")) {
    state.pendingDemoDeadline = undefined; const payload = { acquisitionState: "已取消", reason: "已取消脱敏演示预览；未连接学习通。" }; renderResult(payload); state.runs = [createRun(payload, "取消作业改期预演"), ...state.runs].slice(0, 100); await save(); return payload;
  }
  const payload = await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: "cancel-assignment-deadline-update", confirmationToken }, (response) => resolve(response || { acquisitionState: "已取消", reason: "已取消本次预览，未修改平台。" })));
  renderResult(payload); state.runs = [createRun(payload, "取消作业改期预演"), ...state.runs].slice(0, 50); await save(); return payload;
}
let saveCourseFeedbackTimer;
async function saveCourse() {
  if (state.demoMode) return;
  const active = activeCourse();
  active.name = normalize(courseName.value);
  active.classNames = parseClasses(classNames.value);
  await save();
  renderCourses();
  const complete = Boolean(active.name && active.classNames.length);
  const button = document.querySelector("#save-course");
  if (button) {
    clearTimeout(saveCourseFeedbackTimer);
    button.textContent = "已保存";
    button.disabled = true;
    saveCourseFeedbackTimer = setTimeout(() => { button.textContent = "保存课程范围"; button.disabled = false; }, 1500);
  }
  renderResult({ acquisitionState: "已保存", reason: complete ? `课程范围已保存到本机扩展：课程“${active.name}”，班级白名单 ${active.classNames.length} 个班级。` : "已保存，但课程名称或班级白名单尚未填写完整；扫描前会提示补充。" });
}
async function addCourse() { const course = { id: crypto.randomUUID(), name: "", classNames: [], archived: false }; state.courses.push(course); state.activeCourseId = course.id; await save(); renderCourses(); courseName.focus(); }
async function archiveCurrentCourse() {
  if (state.demoMode) return;
  const current = activeCourse();
  const label = current.name || "未命名课程";
  if (!globalThis.confirm(`归档“${label}”？\n归档后不会删除本机课程范围，仍可恢复。`)) return;
  const outcome = courseState.archiveCourse(state.courses, current.id);
  if (!outcome.ok) { renderResult({ acquisitionState: "未执行", reason: outcome.reason }); return; }
  state.courses = outcome.courses; state.activeCourseId = outcome.nextActiveId; await save(); renderCourses();
  renderResult({ acquisitionState: "已归档", reason: `“${label}”已移入已归档课程，本机配置未删除。` });
}
async function restoreArchivedCourse(courseId) {
  if (state.demoMode) return;
  const outcome = courseState.restoreCourse(state.courses, courseId);
  if (!outcome.ok) { renderResult({ acquisitionState: "未执行", reason: outcome.reason }); return; }
  state.courses = outcome.courses; state.activeCourseId = outcome.restoredCourseId; await save(); renderCourses();
  renderResult({ acquisitionState: "已恢复", reason: "课程已恢复为当前课程，可继续检测连接或执行只读任务。" });
}
async function deleteArchivedCourse(courseId) {
  if (state.demoMode) return;
  const target = courseState.archivedCourses(state.courses).find((course) => course.id === courseId);
  if (!target) return;
  const label = target.name || "未命名课程";
  if (!globalThis.confirm(`删除已归档课程“${label}”？\n本机课程范围和班级白名单将被永久删除，不可恢复。`)) return;
  const outcome = courseState.deleteCourse(state.courses, courseId);
  if (!outcome.ok) { renderResult({ acquisitionState: "未执行", reason: outcome.reason }); return; }
  state.courses = outcome.courses; await save(); renderCourses();
  renderResult({ acquisitionState: "已删除", reason: `已归档课程“${label}”已从本机永久删除；运行记录保持不变。` });
}
function download(filename, contents, type) { const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(new Blob([contents], { type })); anchor.download = filename; anchor.click(); URL.revokeObjectURL(anchor.href); }
function exportReport() { const runs = visibleRuns(); const lines = [state.demoMode ? "# 教学运营助手｜脱敏演示报告" : "# 教学运营助手｜本机运行报告", "", state.demoMode ? "> 本报告完全使用模拟课程与脱敏结果，未连接学习通。" : "> 本报告仅含本机汇总记录，不含账号、Cookie、学生姓名、成绩或真实链接。", "", "| 时间 | 课程 | 任务 | 状态 | 原因 |", "| --- | --- | --- | --- | --- |", ...runs.map((run) => `| ${run.createdAt} | ${run.courseName} | ${run.taskName} | ${run.state} | ${run.detail.replaceAll("|", "／")} |`)]; if (!runs.length) lines.push("| 暂无 | 暂无 | 暂无 | 暂无 | 暂无 |"); download(state.demoMode ? "教学运营助手-脱敏演示报告.md" : "教学运营助手-本机运行报告.md", lines.join("\n"), "text/markdown;charset=utf-8"); }
function exportArchitecture() { download("学习通教学运营自动化系统-脱敏架构图.svg", globalThis.LearningTongDemoMode.architectureSvg(), "image/svg+xml;charset=utf-8"); }
async function toggleDemoMode() { state.demoMode = !state.demoMode; state.pendingDemoDeadline = undefined; await save(); renderCourses(); resetChatForMode(); renderResult({ acquisitionState: state.demoMode ? "演示模式" : "本地模式", reason: state.demoMode ? "已切换为模拟课程和脱敏结果，不连接学习通。" : "已恢复本机真实课程视图；真实任务仍执行页面与范围门禁。" }); }
async function handleCommand() { const text = normalize(command.value); if (!text) return; command.value = ""; addChat("user", text); const deadlineRequest = globalThis.LearningTongDeadlineUpdate?.parseCommand(text, displayCourse()); if (deadlineRequest) { if (!deadlineRequest.ok) { addChat("assistant", `无法生成改期预览：${deadlineRequest.reason}`); renderResult({ acquisitionState: "未获取", reason: deadlineRequest.reason }); return; } addChat("assistant", "已识别为“单条作业截止时间修改”。先全分页唯一定位并显示原时间；你再次确认前不会提交。"); const payload = await prepareDeadlineUpdate(deadlineRequest); addChat("assistant", `${statusText(payload)}：${payload.reason}`); return; } if (/连接|登录状态|页面状态/.test(text)) { addChat("assistant", "已识别为“课程连接检测”。我会核验课程名称、教师登录态和当前业务页面，不读取学生数据。"); const payload = await checkConnection(); addChat("assistant", `${statusText(payload)}：${payload.reason}`); return; } if (/签到|考勤/.test(text)) { addChat("assistant", "已识别为“签到活动与异常审计”。只读汇总；学号、人数或状态未通过门禁时不会进入回填。"); const payload = await scanAttendance(); addChat("assistant", `${statusText(payload)}：${payload.reason}`); return; } if (/章节.*(测试|测验)|(测试|测验).*待批/.test(text)) { addChat("assistant", "已识别为“章节测试待批审计”。只返回目标班级汇总，不会评分或读取学生明细。"); const payload = await scanChapterTests(); addChat("assistant", `${statusText(payload)}：${payload.reason}`); return; } if (/章节.*(结构|目录|任务点)|(结构|目录).*章节/.test(text)) { addChat("assistant", "已识别为“章节结构只读检查”。只读取章节、小节、任务点和开放状态，不修改课程内容。"); const payload = await scanChapterStructure(); addChat("assistant", `${statusText(payload)}：${payload.reason}`); return; } if (/成绩.*(概览|分布|平均)|(概览|分布|平均).*成绩/.test(text)) { addChat("assistant", "已识别为“班级成绩聚合概览”。只返回当前班级平均分和分数段人数，不读取或展示学生明细。"); const payload = await scanScoreOverview(); addChat("assistant", `${statusText(payload)}：${payload.reason}`); return; } if (/课程.*(概览|统计|数据|资源)|(概览|统计).*课程/.test(text)) { addChat("assistant", "已识别为“课程聚合概览”。只读取课程规模、资源和教学运行汇总，不读取学生个人成绩。"); const payload = await scanCourseOverview(); addChat("assistant", `${statusText(payload)}：${payload.reason}`); return; } if (/截止|延期|改期/.test(text)) { addChat("assistant", "已识别为“查看作业截止时间”。如需修改，请写明班级、书名号中的作业标题和完整新时间。"); const payload = await scan("deadlines"); addChat("assistant", `${statusText(payload)}：${payload.reason}`); return; } if (/批改|评分/.test(text)) { addChat("assistant", "先执行普通作业待批核验。只有存在待批，并且本轮作业、班级和评分口径都明确时，才允许生成批改预演。"); const payload = await scan("pending"); const pendingTotal = payload.pendingAssignments?.reduce((sum, item) => sum + Number(item.pending || 0), 0) || 0; addChat("assistant", payload.acquisitionState === "确认无数据" ? "确认无数据：当前白名单班级没有待批作业，不显示批改操作。" : payload.acquisitionState === "采集到" ? `采集到 ${pendingTotal} 项待批；尚未提供本轮评分口径，因此未读取学生提交、未评分。` : `${statusText(payload)}：${payload.reason}`); return; } if (/扫描.*作业|作业.*扫描|待批/.test(text)) { addChat("assistant", "已识别为“作业待批扫描”。我会先核验当前课程、班级范围和教师作业页。"); const payload = await scan("pending"); addChat("assistant", `${statusText(payload)}：${payload.reason}`); return; } if (/成绩/.test(text)) { addChat("assistant", state.demoMode ? "脱敏演示会生成班级成绩汇总，不包含学生明细。请输入“读取成绩概览”。" : "请先在学习通打开“统计 → 学生成绩”，再输入“读取成绩概览”。个人成绩查看与平台成绩提交均未接入。"); return; } if (/课程|班级|白名单/.test(text)) { addChat("assistant", state.demoMode ? "当前为脱敏演示，课程与班级已替换为模拟名称。" : "请在“课程管理”中新增或保存课程。当前扩展支持多课程切换。"); return; } addChat("assistant", "当前已接入连接检测、作业待批、截止时间、单条作业受控改期、章节测试待批、签到异常、课程概览、章节结构和班级成绩概览。AI 只生成批改建议；平台成绩提交和课程内容写入不会自动执行。"); }

extensionApi.storage.local.get([STORE_KEY], (stored) => { const saved = stored[STORE_KEY]; if (saved?.courses?.length) { const courses = saved.courses.map((course) => ({ ...course, archived: course.archived === true })); if (!courseState.activeCourses(courses).length) courses[0].archived = false; const active = courseState.activeCourses(courses); state = { ...defaultState, ...saved, courses, activeCourseId: active.some((course) => course.id === saved.activeCourseId) ? saved.activeCourseId : active[0].id, runs: Array.isArray(saved.runs) ? saved.runs : [] }; } renderCourses(); renderRecentRuns(); refreshScanMeta().catch(() => {}); if (state.demoMode) resetChatForMode(); });
courseSelect.addEventListener("change", async () => { state.activeCourseId = courseSelect.value; await save(); renderCourses(); refreshScanMeta().catch(() => {}); });
document.querySelector("#save-course").addEventListener("click", saveCourse); document.querySelector("#new-course").addEventListener("click", addCourse); document.querySelector("#scan").addEventListener("click", (event) => scan("pending", event.currentTarget)); document.querySelector("#scan-deadlines").addEventListener("click", (event) => scan("deadlines", event.currentTarget)); document.querySelector("#send-command").addEventListener("click", handleCommand); command.addEventListener("keydown", (event) => { if (event.key === "Enter") handleCommand(); }); document.querySelector("#export-report").addEventListener("click", exportReport);
document.querySelector("#show-deadline-form").addEventListener("click", () => toggleDeadlineForm());
document.querySelector("#preview-deadline-update").addEventListener("click", previewDeadlineFromForm);
document.querySelector("#cancel-deadline-form").addEventListener("click", () => toggleDeadlineForm(false));
document.querySelector("#scan-chapter-tests").addEventListener("click", scanChapterTests);
document.querySelector("#scan-attendance").addEventListener("click", scanAttendance);
document.querySelector("#scan-course-overview").addEventListener("click", scanCourseOverview);
document.querySelector("#scan-score-overview").addEventListener("click", scanScoreOverview);
document.querySelector('#generate-teaching-support').addEventListener('click', () => {
  teachingDiagnosis = support.diagnose(teachingPayload);
  const box = document.querySelector('#teaching-support-result'); box.replaceChildren();
  const lines = teachingDiagnosis.ok ? [state.demoMode ? '模拟数据演示，不代表实际教学成效。' : '依据本次页面成绩汇总，建议需教师复核。', teachingDiagnosis.facts, ...teachingDiagnosis.actions, teachingDiagnosis.limits] : [teachingDiagnosis.reason];
  for (const text of lines) { const p = document.createElement('p'); p.textContent = text; box.append(p); }
  document.querySelector('#teaching-support-editor').hidden = !teachingDiagnosis.ok;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
document.querySelector('#export-teaching-support').addEventListener('click', () => {
  if (!teachingDiagnosis?.ok) return;
  const contents = support.report({ diagnosis: teachingDiagnosis, courseName: displayCourse().name, demo: state.demoMode, goal: document.querySelector('#teaching-goal').value, implementation: document.querySelector('#teaching-implementation').value, observation: document.querySelector('#teaching-observation').value, generatedAt: new Date().toLocaleString('zh-CN') });
  download('教学支持与实施记录.md', contents, 'text/markdown;charset=utf-8');
});
const rubricLabel = document.createElement('label'); rubricLabel.textContent = '评分口径模板（应用后可修改，保存后生效）';
const rubricSelect = document.createElement('select'); rubricSelect.id = 'ai-rubric-template';
for (const [value, text] of [['', '保留当前口径'], ['nlp', '自然语言处理实践'], ['aigc', 'AIGC应用实践']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; rubricSelect.append(option); }
rubricLabel.append(rubricSelect); aiCriteria.parentElement.before(rubricLabel);
rubricSelect.addEventListener('change', () => { if (support.rubrics[rubricSelect.value] && globalThis.confirm('替换当前输入框的评分口径？保存设置后才会用于AI批改。')) aiCriteria.value = support.rubrics[rubricSelect.value]; });
document.querySelector("#scan-chapter-structure").addEventListener("click", scanChapterStructure);
function setAiConfigStatus(text, tone) {
  aiConfigStatus.textContent = text;
  aiConfigStatus.className = `settings-note ${tone || ""}`;
}
async function loadAiConfigPanel() {
  const response = await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: "ai-config-get" }, (result) => resolve(result)));
  if (!response?.ok) { setAiConfigStatus("AI 配置读取失败。", "ai-status-error"); return; }
  const config = response.config;
  aiBaseUrl.value = config.baseUrl || aiGrading.DEFAULT_CONFIG.baseUrl;
  aiApiKey.value = config.hasKey ? "********" : "";
  aiModel.value = config.model || aiGrading.DEFAULT_CONFIG.model;
  aiCriteria.value = config.criteria || aiGrading.DEFAULT_CONFIG.criteria;
  aiCommentEnabled.checked = config.commentEnabled !== false;
  aiAttachmentEnabled.checked = config.attachmentEnabled === true;
  document.getElementById("ai-remember-key").checked = config.rememberKey === true;
  setAiConfigStatus(config.hasKey ? `已配置：模型 ${config.model}。批阅页将出现“AI 批改本题”面板。` : "尚未配置 API Key。");
}
async function saveAiConfigPanel() {
  const button = document.querySelector("#save-ai-config");
  setButtonBusy(button, true, "保存中…");
  const origin = aiGrading.originPattern(aiBaseUrl.value);
  if (!origin) { setButtonBusy(button, false); setAiConfigStatus("API 地址无效，必须使用 HTTPS。", "ai-status-error"); return; }
  const granted = extensionApi.permissions?.request ? await new Promise((resolve) => extensionApi.permissions.request({ origins: [origin] }, resolve)) : false;
  if (!granted) { setButtonBusy(button, false); setAiConfigStatus(`未授权 ${origin}，AI 请求不会发送。`, "ai-status-error"); return; }
  const response = await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: "ai-config-save", config: { baseUrl: aiBaseUrl.value, apiKey: aiApiKey.value, model: aiModel.value, criteria: aiCriteria.value, commentEnabled: aiCommentEnabled.checked, attachmentEnabled: aiAttachmentEnabled.checked, rememberKey: document.getElementById("ai-remember-key").checked } }, (result) => resolve(result)));
  setButtonBusy(button, false);
  if (!response?.ok) { setAiConfigStatus(response?.reason || "保存失败。", "ai-status-error"); return; }
  aiApiKey.value = response.config.hasKey ? "********" : "";
  setAiConfigStatus(`已保存：模型 ${response.config.model}${response.config.commentEnabled === false ? "，仅回填分数" : ""}。批阅页将出现“AI 批改本题”面板。`, "ai-status-ok");
}
async function clearAiConfigPanel() {
  const response = await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: "ai-config-clear" }, (result) => resolve(result)));
  if (!response?.ok) { setAiConfigStatus(response?.reason || "清除失败。", "ai-status-error"); return; }
  aiApiKey.value = "";
  aiAttachmentEnabled.checked = false;
  setAiConfigStatus(response.reason, "ai-status-ok");
}
async function testAiConfigPanel() {
  const button = document.querySelector("#test-ai-config");
  setButtonBusy(button, true, "测试中…");
  setAiConfigStatus("正在连接 AI API…");
  const response = await new Promise((resolve) => extensionApi.runtime.sendMessage({ type: "ai-config-test" }, (result) => resolve(result)));
  setButtonBusy(button, false);
  setAiConfigStatus(response?.reason || (response?.ok ? "连接成功。" : "连接失败。"), response?.ok ? "ai-status-ok" : "ai-status-error");
}
document.querySelector("#open-grading-workspace").addEventListener("click", async () => {
  if (state.demoMode) { showResultToUser({ acquisitionState: "待人工复核", reason: "请在独立工作台使用脱敏试用；当前演示不会连接真实课程。" }); return; }
  const url = extensionApi.runtime.getURL("workspace/workspace.html");
  const existing = await extensionApi.tabs.query({ url });
  if (existing.length) await extensionApi.tabs.update(existing[0].id, { active: true });
  else await extensionApi.tabs.create({ url });
});
document.querySelector("#save-ai-config").addEventListener("click", saveAiConfigPanel);
document.querySelector("#test-ai-config").addEventListener("click", testAiConfigPanel);
document.querySelector("#clear-ai-config").addEventListener("click", clearAiConfigPanel);
loadAiConfigPanel();
document.querySelector("#check-connection").addEventListener("click", checkConnection);
extensionApi.runtime.onMessage.addListener((message) => {
  if (message?.type === "scan-progress") showResultToUser({ acquisitionState: "正在扫描", reason: message.reason });
});
archiveCurrentCourseButton.addEventListener("click", archiveCurrentCourse);
runFilter.addEventListener("change", renderRecentRuns);
toggleDemoModeButton.addEventListener("click", toggleDemoMode);
document.querySelector("#export-architecture").addEventListener("click", exportArchitecture);
globalThis.LearningTongPopupBridge = Object.freeze({
  get state() { return state; },
  activeCourse,
  renderResult,
  setButtonBusy,
  createRun,
  save,
});
})();
