(() => {
  const F = globalThis.LearningTongFollowup, B = globalThis.LearningTongBatch, W = globalThis.LearningTongWorkspaceBridge;
  const $ = id => document.getElementById(id), node = (tag, text) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
  let courses = [], scans = {}, snapshots = [], ownDemo = false, running = false, cancelled = false, workbook = null, pendingRestore = null;
  let data = { raw: null, report: null, draft: "", draftBasis: "" };
  const isDemo = () => ownDemo || W.isDemo();
  const demoScope = { courseName: "教学运营演示课程", className: "演示班A", workTitle: "示例作业", kind: "assignment" };
  const current = () => isDemo() ? { scope: demoScope } : W.scope();
  const scopeKey = () => { const c = current(); return c ? JSON.stringify([c.scope.courseName, c.scope.className, c.scope.workTitle, c.scope.kind, c.scope.courseId, c.scope.classId, c.scope.workId]) : ""; };
  const notice = message => { $("roster-status").textContent = message; W.notice(message); };
  const download = (text, name, type) => { const url = URL.createObjectURL(new Blob([text], { type })); const a = node("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const validReport = () => data.report && data.raw?.scopeKey === scopeKey() && $("roster-confirm").checked;
  async function persist() {
    if (isDemo() || !W.live) return;
    if (JSON.stringify(data).length > 1000000) throw new Error("本次名单与草稿超过1MB，不写入磁盘；请使用更小的完整班级名单。");
    await chrome.storage.session.set({ teachingFollowupSession: data });
  }
  function clearDraft() { data.draft = ""; data.draftBasis = ""; $("reminder-approved").checked = false; }
  function invalidate() { data.report = null; clearDraft(); $("roster-export-consent").checked = false; }
  function renderTodos() {
    const activeCourses = isDemo() ? [{ id: "demo", name: demoScope.courseName, classNames: [demoScope.className] }] : courses;
    const demoSnapshots = [F.taskSnapshot(activeCourses[0] || {}, { acquisitionState: "采集到", signals: { crossFrameVerified: true }, pendingAssignments: [{ pending: 5 }], assignmentDeadlines: [{ title: "示例作业", className: "演示班A", deadline: F.displayTime(Date.now() + 2 * 3600000) }] }, Date.now())];
    const list = $("todo-list"); list.replaceChildren();
    if (!activeCourses.length) { list.append(node("p", "尚未配置课程。可在插件弹窗的课程管理中保存课程和班级范围。")); return; }
    for (const item of F.todos(activeCourses, isDemo() ? {} : scans, isDemo() ? demoSnapshots : snapshots, Date.now())) {
      const row = node("div"); row.className = "todo-row";
      row.append(node("strong", `${item.courseName} · ${item.title}`), node("small", item.at ? `历史采集时间：${F.displayTime(item.at)}（北京时间）` : "采集时间：未获取"), node("p", item.reason));
      if (item.kind === "pending") { const button = node("button", "扫描此课程待批与截止时间"); button.disabled = running; button.addEventListener("click", run(() => scanCourse(activeCourses.find(c => c.name === item.courseName)))); row.append(button); }
      list.append(row);
    }
  }
  function render() {
    $("operations-mode").textContent = isDemo() ? "脱敏模拟：名单、人数及时间安排为示例，不连接平台、不发送通知。" : "历史扫描不是实时状态；名单与通知仅本浏览器会话保留，不自动发送。";
    $("operations-card").querySelectorAll("button,input,select,textarea").forEach(n => { n.disabled = running; });
    $("roster-cancel").disabled = !running;
    $("roster-read-sheet").disabled = running || !workbook;
    $("roster-export").disabled = running || !validReport();
    $("reminder-generate").disabled = running || !validReport();
    $("reminder-export").disabled = running || !validReport() || !data.draft;
    $("reminder-draft").value = data.draft;
    const c = current(); $("roster-scope").textContent = c ? `${c.scope.courseName} / ${c.scope.className} / ${c.scope.workTitle}` : "尚未确认本次范围。请先在下方识别并核对教师批阅页面。";
    renderTodos(); renderRoster();
  }
  function renderRoster() {
    const holder = $("roster-list"); holder.replaceChildren();
    if (!data.report) return;
    const filter = $("roster-filter").value, table = node("table"), header = node("tr");
    for (const name of ["姓名", "学号", "判断", "提交时间", "截止时间", "依据"]) header.append(node("th", name)); table.append(header);
    const list = data.report.entries.filter(e => filter === "all" || filter === "unsubmitted" ? (filter === "all" || ["unsubmitted", "overdue"].includes(e.status)) : filter === "exceptions" ? ["unsubmitted", "overdue", "late", "review"].includes(e.status) : e.status === filter);
    for (const e of list) { const row = node("tr"); [e.studentName, e.studentNo, F.labels[e.status], e.submitTime || "未获取", e.deadline || "未获取", e.reason].forEach(v => row.append(node("td", v))); table.append(row); }
    holder.append(table, node("p", `当前筛选${list.length}人；名单总人数${data.report.total}人。`));
  }
  function run(action) { return async () => {
    if (running || !W.lock()) { notice("另一项工作台任务正在进行，请先等待。"); return; }
    running = true; cancelled = false; render();
    try { await action(); } catch (e) { notice(`未获取或待核对：${e.message}`); }
    finally { try { await persist(); } catch (e) { notice(e.message); } running = false; W.unlock(); render(); }
  }; }
  async function refreshTodos() {
    if (isDemo()) { renderTodos(); return; }
    if (!W.live) throw new Error("请从已安装插件打开工作台，或使用脱敏演示。");
    const saved = await chrome.storage.local.get(["teachingOperationsExtension", "lastScans", "teachingTodoSnapshots"]);
    courses = (saved.teachingOperationsExtension?.courses || []).filter(c => !c.archived && c.name);
    scans = saved.lastScans || {}; snapshots = (saved.teachingTodoSnapshots || []).slice(0, 100); renderTodos();
  }
  async function scanCourse(course) {
    if (isDemo()) { notice("脱敏模拟不连接学习通，请查看示例待办。"); return; }
    if (!course?.classNames?.length) throw new Error("请先在课程管理配置班级范围。");
    const result = await W.send({ type: "scan-active-assignment-page", profile: { courseName: course.name, classNames: course.classNames } });
    const captured = F.taskSnapshot(course, result, Date.now());
    snapshots = [captured, ...snapshots.filter(s => !(s.courseName === captured.courseName && JSON.stringify(s.classNames) === JSON.stringify(captured.classNames)))].slice(0, 100);
    await chrome.storage.local.set({ teachingTodoSnapshots: snapshots }); await refreshTodos();
    notice(captured.state === "未获取" ? `未获取：${captured.reason}` : "已更新该课程的待批与截止时间快照；名单需另行完整核验。");
  }
  async function scanRoster() {
    if (isDemo()) { demo(); return; }
    const target = current(); F.validateScope(target?.scope);
    if (!target.tabId) throw new Error("请重新识别目标教师批阅列表，再扫描完整名单。");
    data = { raw: null, report: null, draft: "", draftBasis: "" }; $("roster-confirm").checked = false; $("roster-export-consent").checked = false; await persist();
    const start = await W.send({ type: "batch-followup-start", ...target }); if (!start.ok) throw new Error(start.reason);
    const records = [], key = scopeKey(), began = Date.now(); let pages = null, total = null;
    try {
      for (let p = 1; p <= (pages ?? 1); p++) {
        if (cancelled || Date.now() - began > 180000) throw new Error("名单扫描已取消或超时，未证明完整，不整理催交对象。");
        notice(`正在独立读取全部名单第${p}/${pages ?? "待核验"}页，不读取答案或写入平台…`);
        const r = await W.send({ type: "batch-followup-page", id: start.id, pageNumber: p }); if (!r.ok) throw new Error(r.reason || "未获取完整名单。");
        if (!r.data?.completeFilter || (pages !== null && (pages !== r.data.totalPages || total !== r.data.total))) throw new Error("扫描期间名单总数、分页或筛选变化，请重新采集。");
        pages = r.data.totalPages; total = r.data.total; records.push(...r.data.rows);
      }
      if (cancelled || scopeKey() !== key || records.length !== total) throw new Error("名单范围已变化或读取人数与平台总人数不一致。");
      data.raw = { rows: records, scopeKey: key, scope: target.scope, source: "platform", at: Date.now(), complete: true, total }; $("roster-total").value = total;
      await persist(); notice(`已读取平台全部${pages}页、${total}人。请核对范围与截止口径，勾选确认后整理。`);
    } finally { await W.send({ type: "batch-followup-finish", id: start.id }); }
  }
  async function pickWorkbook() {
    if (isDemo()) throw new Error("脱敏演示不读取真实名单文件，请重新打开真实工作台后导入。");
    F.validateScope(current()?.scope); workbook = null; invalidate(); data.raw = null; await persist();
    const file = $("roster-file").files[0]; if (!file || file.size > 5000000 || !/\.(xlsx|csv)$/i.test(file.name)) throw new Error("请选择5MB以内的xlsx或UTF-8 CSV名单。");
    workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true });
    $("roster-sheet").replaceChildren(); for (const name of workbook.SheetNames) { const option = node("option", name); option.value = name; $("roster-sheet").append(option); }
    if (!workbook.SheetNames.length) throw new Error("没有可读取工作表。");
    $("roster-confirm").checked = false; notice("已读取文件结构。请选择工作表，再读取并确认完整名单与本次任务范围。");
  }
  async function readSheet() {
    const c = current(); F.validateScope(c?.scope); invalidate(); data.raw = null; $("roster-confirm").checked = false; if (!workbook) throw new Error("请先导入名单文件。");
    const sheet = workbook.Sheets[$("roster-sheet").value]; if (!sheet?.["!ref"]) throw new Error("选中工作表为空。");
    const bounds = XLSX.utils.decode_range(sheet["!ref"]); if (bounds.e.r > 5000 || bounds.e.c > 40) throw new Error("工作表超过5000行或41列，请使用一班一任务的完整小表。");
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false, raw: true });
    const headers = matrix[0].map(B.norm);
    for (let r = 1; r < matrix.length; r++) for (let c = 0; c < headers.length; c++) {
      if (typeof matrix[r][c] !== "number") continue;
      if (["学号", "学生学号"].includes(headers[c])) { throw new Error("学号须为文本，避免前导零丢失或数值精度变化。请在源表将学号改为文本后重新导出。"); }
      else if (["提交时间", "交卷时间", "截止时间", "作业截止时间"].includes(headers[c])) {
        const d = XLSX.SSF.parse_date_code(matrix[r][c], { date1904: Boolean(workbook.Workbook?.WBProps?.date1904) });
        if (!d) throw new Error("表格日期无法完整解析，请改为YYYY-MM-DD HH:mm:ss文本。");
        matrix[r][c] = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")} ${String(d.H).padStart(2, "0")}:${String(d.M).padStart(2, "0")}:${String(Math.floor(d.S)).padStart(2, "0")}`;
      }
    }
    const rows = F.fromSheet(matrix); data.raw = { rows, scopeKey: scopeKey(), scope: current().scope, source: "import", at: Date.now(), total: rows.length, complete: true }; invalidate();
    $("roster-total").value = ""; $("roster-confirm").checked = false; await persist();
    notice(`选中表读取${rows.length}行；请对照完整名单填写总人数，核对范围并确认。导入时间不代表平台实时状态。`);
  }
  async function analyze() {
    if (!data.raw || data.raw.scopeKey !== scopeKey()) throw new Error("尚未获取当前任务完整名单，或范围已变化。");
    invalidate();
    const total = Number($("roster-total").value); if ($("roster-total").value === "") throw new Error("请填写并核对完整名单总人数。");
    data.report = F.analyzeRoster(data.raw.scope, data.raw.rows, { confirmed: $("roster-confirm").checked, complete: data.raw.complete, source: data.raw.source, at: data.raw.at, total, deadline: $("roster-deadline").value });
    await persist(); const c = data.report.counts;
    notice(`${data.raw.source === "import" ? "教师导入并确认" : data.raw.source === "demo" ? "脱敏模拟" : "平台全分页"} · 统计时间${F.displayTime(data.report.at)}（北京时间）：未交${c.unsubmitted + c.overdue}人（逾期${c.overdue}人）、迟交${c.late}人、待核验${c.review}人；总人数${data.report.total}。`);
  }
  function exportRoster() { if (!validReport() || !$("roster-export-consent").checked) throw new Error("请先确认名单及含身份信息的文件导出用途。"); download(F.rosterCsv(data.report), "作业异常名单_教师核对.csv", "text/csv;charset=utf-8"); notice("异常名单已导出，文件含学生身份信息，请妥善保管。"); }
  async function generateReminder() { if (!validReport()) throw new Error("请先确认并整理当前任务的名单。"); data.draft = F.reminder(data.report, $("reminder-note").value); data.draftBasis = JSON.stringify(data.report); $("reminder-approved").checked = false; await persist(); notice("催交草稿已生成，不含身份字段；请核对最新提交情况后自行发布。"); }
  function exportReminder() { if (!validReport() || !data.draft || data.draftBasis !== JSON.stringify(data.report) || !$("reminder-approved").checked) throw new Error("请重新核对有效名单与通知内容，并勾选教师发布确认。"); download(data.draft, "催交通知_教师审核稿.txt", "text/plain;charset=utf-8"); notice("通知审核稿已导出，请由教师自行发布；插件未发送通知。"); }
  function demo() {
    ownDemo = true; workbook = null; clearDraft(); const now = Date.now(), deadline = F.displayTime(now - 24 * 3600000);
    data.raw = { scope: demoScope, scopeKey: scopeKey(), source: "demo", at: now, complete: true, total: 4, rows: [
      { studentName: "演示学生甲", studentNo: "demo-a", status: "未交", submitTime: "", deadline },
      { studentName: "演示学生乙", studentNo: "demo-b", status: "已交", submitTime: F.displayTime(now - 20 * 3600000), deadline },
      { studentName: "演示学生丙", studentNo: "demo-c", status: "已交", submitTime: F.displayTime(now - 26 * 3600000), deadline },
      { studentName: "演示学生丁", studentNo: "demo-d", status: "未知", submitTime: "", deadline },
    ] }; invalidate(); $("roster-total").value = 4; $("roster-confirm").checked = false; $("roster-panel").open = true; notice("已加载4人脱敏示例，请确认名单口径后整理。没有读取真实学生记录。"); render();
  }
  for (const [id, action] of Object.entries({ "todo-refresh": refreshTodos, "roster-scan": scanRoster, "roster-read-sheet": readSheet, "roster-analyze": analyze, "roster-export": exportRoster, "reminder-generate": generateReminder, "reminder-export": exportReminder, "roster-clear": async () => { pendingRestore = null; ownDemo = false; workbook = null; data = { raw: null, report: null, draft: "", draftBasis: "" }; $("roster-confirm").checked = false; $("roster-export-consent").checked = false; $("reminder-approved").checked = false; $("roster-file").value = ""; $("roster-total").value = ""; $("roster-deadline").value = ""; $("reminder-note").value = ""; if (W.live) await chrome.storage.session.remove("teachingFollowupSession"); notice("已清除名单与通知，未修改平台。"); } })) $(id).addEventListener("click", run(action));
  $("roster-sheet").addEventListener("change", () => { invalidate(); data.raw = null; $("roster-confirm").checked = false; $("roster-total").value = ""; persist().catch(e => notice(e.message)); render(); });
  $("roster-file").addEventListener("change", run(pickWorkbook));
  $("operations-demo").addEventListener("click", () => { if (!running && !data.raw) demo(); else notice("请先清除已有名单再切换演示，避免混用真实材料。"); });
  $("roster-cancel").addEventListener("click", () => { cancelled = true; notice("将在当前页读取结束后停止；不会把部分名单当作完整结果。"); });
  $("roster-filter").addEventListener("change", renderRoster);
  for (const id of ["roster-total", "roster-deadline"]) $(id).addEventListener("input", () => { invalidate(); $("roster-confirm").checked = false; persist().catch(e => notice(e.message)); render(); });
  $("roster-confirm").addEventListener("change", () => { if (!$("roster-confirm").checked) { invalidate(); persist().catch(e => notice(e.message)); render(); } });
  $("reminder-note").addEventListener("input", () => { clearDraft(); persist().catch(e => notice(e.message)); render(); });
  $("reminder-draft").addEventListener("input", () => { data.draft = $("reminder-draft").value; $("reminder-approved").checked = false; });
  $("reminder-draft").addEventListener("change", () => persist().catch(e => notice(e.message)));
  window.addEventListener("learningtong-scope", () => {
    if (!data.raw && pendingRestore?.raw?.scopeKey === scopeKey()) {
      data = { raw: pendingRestore.raw, report: null, draft: "", draftBasis: "" }; pendingRestore = null;
      $("roster-total").value = data.raw.total; $("roster-confirm").checked = false;
      notice("已恢复会话名单，请重新核对当前提交情况、完整人数与截止口径；旧通知不自动恢复有效。");
    }
    if (data.raw && data.raw.scopeKey !== scopeKey()) { data = { raw: null, report: null, draft: "", draftBasis: "" }; $("roster-confirm").checked = false; $("reminder-approved").checked = false; $("roster-deadline").value = ""; $("reminder-note").value = ""; persist().catch(e => notice(e.message)); notice("任务范围或演示模式变化，旧名单和通知已失效。"); } render(); });
  (async () => { if (W.live) { const session = await chrome.storage.session.get("teachingFollowupSession"); pendingRestore = session.teachingFollowupSession || null; window.dispatchEvent(new Event("learningtong-scope")); await refreshTodos(); } render(); })().catch(e => notice(e.message));
})();
