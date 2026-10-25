(() => {
  const B = globalThis.LearningTongBatch, norm = B.norm;
  const labels = { unsubmitted: "未交", overdue: "逾期未交", late: "迟交", ontime: "已交（未迟交）", review: "待核验", exempt: "免交/未开始" };
  // School timestamps without an offset are interpreted as Beijing time, never OS time.
  function timeOf(value) {
    const raw = norm(value);
    const m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/);
    if (!m) return null;
    const [year, month, day, hour, minute, second] = m.slice(1, 7).map(v => Number(v || 0));
    if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
    const utc = Date.UTC(year, month - 1, day, hour, minute, second), d = new Date(utc);
    if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    let offset = 480;
    if (m[7] === "Z") offset = 0;
    else if (m[7]) { const parts = m[7].slice(1).split(":").map(Number); if (parts[0] > 14 || parts[1] > 59 || (parts[0] === 14 && parts[1])) return null; offset = (parts[0] * 60 + parts[1]) * (m[7][0] === "+" ? 1 : -1); }
    return utc - offset * 60000;
  }
  const displayTime = at => { const d = new Date(at + 480 * 60000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`; };
  function deadlineOf(text) {
    const raw = norm(text);
    if (timeOf(raw) !== null) return raw;
    const parts = raw.split(/\s*(?:~|～|至)\s*/);
    return parts.length === 2 && timeOf(parts[0]) !== null && timeOf(parts[1]) !== null ? parts[1] : "";
  }
  function validateScope(scope) {
    if (!scope || !["assignment", "chapter"].includes(scope.kind) || ["courseName", "className", "workTitle"].some(k => !norm(scope[k]))) throw new Error("请先明确一门课程、一个班级、一份任务。");
  }
  function classify(row, fallbackDeadline, now) {
    const rawStatus = norm(row.status), submitted = timeOf(row.submitTime), deadline = timeOf(row.deadline || fallbackDeadline);
    const base = { studentName: norm(row.studentName), studentNo: norm(row.studentNo), rawStatus, submitTime: norm(row.submitTime), deadline: norm(row.deadline || fallbackDeadline) };
    const result = (status, reason) => ({ ...base, status, reason });
    if (!base.studentName || !base.studentNo) return result("review", "姓名或学号缺失，无法可靠识别。");
    if (/^(免交|无需提交|未开始|未发布)$/.test(rawStatus)) return result("exempt", "保留平台免交或未开始状态，不计入催交。");
    if (/^(未交|未提交|未作答)$/.test(rawStatus)) {
      if (submitted !== null || (base.submitTime && !/^(--|-|暂无|未提交)$/.test(base.submitTime))) return result("review", "未交状态与提交时间矛盾。");
      return result(deadline !== null && now > deadline ? "overdue" : "unsubmitted", deadline === null ? "未交状态明确，截止时间未获取，不能判为逾期。" : now > deadline ? "截至采集时间已超过截止时间。" : "截至采集时间未交，尚未超过截止时间。");
    }
    if (!/^(已交|已提交|已批|待批|未批|迟交|已迟交)$/.test(rawStatus)) return result("review", "提交状态无法可靠识别。");
    if (submitted === null || deadline === null || submitted > now) return result("review", "提交/截止时间缺失、无效或在采集时间之后，迟交未核验。");
    if (/迟交/.test(rawStatus) && submitted <= deadline) return result("review", "平台迟交标记与时间比较矛盾。");
    return result(submitted > deadline ? "late" : "ontime", "按本次确认的提交时间与截止时间比较；恰好截止时提交不计迟交。");
  }
  function analyzeRoster(scope, rows, options = {}) {
    validateScope(scope);
    if (!options.confirmed || !options.complete || !["platform", "import", "demo"].includes(options.source)) throw new Error("请确认名单来源与完整范围；读取失败不能当作没有未交。");
    if (!Array.isArray(rows) || rows.length > 5000 || !Number.isFinite(options.at)) throw new Error("名单行数或采集时间无效。");
    if (!Number.isInteger(options.total) || options.total !== rows.length) throw new Error("名单人数与确认总人数不一致，不能宣称完整。");
    if (options.deadline && timeOf(options.deadline) === null) throw new Error("统一截止时间无效，请填写完整日期和时间。");
    const ids = new Set();
    for (const row of rows) {
      if (row.courseName && norm(row.courseName) !== norm(scope.courseName)) throw new Error("名单中存在其他课程，不能混入本次任务。");
      if (row.className && norm(row.className) !== norm(scope.className)) throw new Error("名单中存在其他班级，不能混入本次任务。");
      if (row.workTitle && norm(row.workTitle) !== norm(scope.workTitle)) throw new Error("名单中存在其他作业或测验。");
      const id = norm(row.studentNo); if (id && ids.has(id)) throw new Error("学号重复，不能静默合并或漏算。"); if (id) ids.add(id);
    }
    const entries = rows.map(row => classify(row, options.deadline, options.at));
    return { scope: { courseName: norm(scope.courseName), className: norm(scope.className), workTitle: norm(scope.workTitle), kind: scope.kind }, at: options.at, source: options.source, total: rows.length, entries, counts: Object.fromEntries(Object.keys(labels).map(s => [s, entries.filter(e => e.status === s).length])), acquisitionState: entries.some(e => e.status === "review") ? "待人工复核" : "采集到" };
  }
  function fromSheet(rows) {
    if (!Array.isArray(rows) || rows.length < 2 || rows.length > 5001) throw new Error("名单须含表头和1～5000条学生记录。");
    const fields = { courseName: ["课程", "课程名称"], studentName: ["姓名", "学生姓名"], studentNo: ["学号", "学生学号"], status: ["提交状态", "状态"], submitTime: ["提交时间", "交卷时间"], deadline: ["截止时间", "作业截止时间"], className: ["班级", "班级名称"], workTitle: ["作业名称", "测验名称", "任务名称"] };
    const header = rows[0].map(norm), indexes = {};
    for (const [field, names] of Object.entries(fields)) { const matches = header.flatMap((s, n) => names.includes(s) ? [n] : []); if (matches.length > 1) throw new Error(`表头${names[0]}重复或含多个同义列。`); indexes[field] = matches[0] ?? -1; }
    if (["studentName", "studentNo", "status"].some(k => indexes[k] < 0)) throw new Error("表头至少需要姓名、学号、提交状态；迟交判断还需提交时间和截止时间。");
    return rows.slice(1).filter(row => row.some(v => norm(v))).map(row => Object.fromEntries(Object.entries(indexes).map(([key, i]) => [key, i < 0 ? "" : norm(row[i])])));
  }
  function rosterCsv(report, mode = "exceptions") {
    const selected = report.entries.filter(e => mode === "all" || ["unsubmitted", "overdue", "late", "review"].includes(e.status));
    const cell = v => { let s = String(v ?? ""); if (/^[\s]*[=+@-]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    return "\uFEFF" + [["课程", "班级", "任务", "姓名", "学号", "判断结果", "平台状态", "提交时间", "截止时间", "判断依据", "统计时间（北京时间）", "来源"], ...selected.map(e => [report.scope.courseName, report.scope.className, report.scope.workTitle, e.studentName, e.studentNo, labels[e.status], e.rawStatus, e.submitTime, e.deadline, e.reason, displayTime(report.at), report.source === "platform" ? "平台全分页" : report.source === "demo" ? "脱敏模拟" : "教师导入并确认"])].map(row => row.map(cell).join(",")).join("\r\n");
  }
  function reminder(report, teacherNote = "") {
    const count = report.counts.unsubmitted + report.counts.overdue;
    if (!count) throw new Error("没有已确认的未交对象；迟交或待核验人员不纳入催交。");
    return `${report.source === "demo" ? "【脱敏模拟通知，不用于真实发送】\n" : ""}【${report.scope.courseName}作业提醒】\n${report.scope.className}尚未提交《${report.scope.workTitle}》的同学：\n截至${displayTime(report.at)}（北京时间），本次确认名单中有${count}人未交，其中${report.counts.overdue}人已超过所列截止时间。请先核对学习通提交记录；若已提交，请忽略此提醒并告知任课教师核实。\n${norm(teacherNote) || "请查看学习通该任务的当前提交安排；遇到提交问题及时联系任课教师。"}\n本通知仅为教师审核草稿，不含学生姓名或学号；发布前请再次核对最新名单与截止安排。`;
  }
  function taskSnapshot(course, payload, at) {
    const state = payload?.acquisitionState || "未获取";
    const pendingRows = payload?.pendingAssignments || [], deadlines = payload?.assignmentDeadlines || [];
    const intact = Array.isArray(pendingRows) && Array.isArray(deadlines) && deadlines.length <= 1000 && pendingRows.every(r => Number.isInteger(r.pending) && r.pending >= 0);
    const valid = ["采集到", "确认无数据"].includes(state) && payload?.signals?.crossFrameVerified && intact && Number.isFinite(at);
    return { courseName: norm(course.name), classNames: (course.classNames || []).map(norm), at, state: valid ? state : "未获取", reason: intact ? norm(payload?.reason).slice(0, 240) : "快照超限或数量无效，未获取完整结果。", pending: valid ? pendingRows.reduce((s, r) => s + r.pending, 0) : null, deadlines: valid ? deadlines.map(d => ({ title: norm(d.title), className: norm(d.className), deadline: norm(d.deadline) })) : [] };
  }
  function todos(courses, scans, snapshots, now) {
    const result = [];
    for (const course of courses.filter(c => !c.archived)) {
      const saved = snapshots.find(s => s.courseName === course.name && JSON.stringify(s.classNames) === JSON.stringify(course.classNames || []));
      const last = scans?.[course.name]?.["assignment-pending"];
      const state = saved?.state || last?.state || "未获取", at = saved?.at || last?.at || null;
      const pending = saved?.pending ?? null;
      result.push({ courseName: course.name, kind: "pending", title: state === "未获取" || pending === null ? "作业待批：未获取" : pending > 0 ? `作业待批：${pending}份` : "上次扫描范围内无待批", at, needsAction: state === "未获取" || pending !== 0, historical: true, reason: saved?.reason || "历史快照未绑定本次班级范围，需重新扫描确认。" });
      const chapter = scans?.[course.name]?.chapter, attendance = scans?.[course.name]?.attendance;
      for (const [kind, item, title] of [["chapter", chapter, "章节测试"], ["attendance", attendance, "签到异常"]]) result.push({ courseName: course.name, kind, title: `${title}：${item?.state || "未获取"}`, at: item?.at || null, needsAction: item?.state !== "确认无数据", historical: true, reason: item?.summary || "尚未取得扫描结果；课程专属模块需已验证配置。" });
      if (!saved || saved.state === "未获取" || !saved.deadlines.length) result.push({ courseName: course.name, kind: "deadline", title: "作业截止时间：未获取", at, needsAction: true, historical: true, reason: "刷新此课程待批与截止时间后查看，不从缺失数据推断。" });
      else for (const d of saved.deadlines) {
        const end = timeOf(deadlineOf(d.deadline));
        if (end === null || end <= now + 72 * 3600000) result.push({ courseName: course.name, kind: "deadline", title: end === null ? `截止时间需核对：${d.title}` : end < now ? `已到截止时间：${d.title}` : `72小时内截止：${d.title}`, at: saved.at, needsAction: true, historical: true, reason: `${d.className} · ${d.deadline}；不据此认定学生未交。` });
      }
    }
    return result;
  }
  globalThis.LearningTongFollowup = Object.freeze({ labels, timeOf, displayTime, deadlineOf, validateScope, analyzeRoster, fromSheet, rosterCsv, reminder, taskSnapshot, todos });
})();
