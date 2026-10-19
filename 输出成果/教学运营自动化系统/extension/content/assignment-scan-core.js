(() => {
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const countOf = (pattern, text) => Number(normalize(text).match(pattern)?.[1] || 0);
  const deadlineOf = (text) => normalize(normalize(text).match(/作答时间[:：]?\s*(.+?)(?=\s+\d+\s*待批|\s+待批|$)/)?.[1]);

  function scanSnapshot(snapshot = {}, profile = {}) {
    const courseName = normalize(profile.courseName);
    const classNames = Array.isArray(profile.classNames) ? profile.classNames.map(normalize).filter(Boolean) : [];
    if (!courseName || !classNames.length) return { acquisitionState: "未获取", reason: "请先在扩展中填写课程名称和班级白名单。", signals: {} };
    const bodyText = normalize(snapshot.bodyText);
    const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
    const explicitEmpty = /暂无.{0,8}作业|没有.{0,8}作业|无作业/.test(bodyText);
    const signals = {
      courseContext: bodyText.includes(courseName),
      assignmentContext: /作业|待批|批阅/.test(`${snapshot.title || ""} ${bodyText}`),
      listEntry: rows.length > 0 || explicitEmpty,
      framePath: normalize(snapshot.path),
    };
    if (!signals.assignmentContext || !signals.listEntry) return { acquisitionState: "未获取", reason: "当前 frame 未识别到作业列表入口。", signals };
    if (explicitEmpty && rows.length === 0) return { acquisitionState: "未获取", reason: "作业页显示空列表，但未证明班级筛选已生效，不能据此确认无数据。", signals };

    const assignments = rows.map((row) => {
      const text = normalize(row.text);
      const className = classNames.find((name) => text.includes(name));
      if (!className) return undefined;
      return { title: normalize(row.title) || "未命名作业", className, pending: countOf(/(\d+)\s*待批/, text), submitted: countOf(/(\d+)\s*已交/, text), deadline: deadlineOf(text), page: normalize(row.page) || "当前页" };
    }).filter(Boolean);
    const missingClasses = classNames.filter((name) => !assignments.some((item) => item.className === name));
    if (missingClasses.length) return { acquisitionState: "未获取", reason: `当前页未看到目标班级：${missingClasses.join("、")}；不能确认班级范围。`, signals, scopeVerified: false };

    const pendingAssignments = assignments.filter((item) => item.pending > 0);
    const scannedPages = Array.isArray(snapshot.scannedPages) && snapshot.scannedPages.length
      ? snapshot.scannedPages.map(normalize).filter(Boolean)
      : ["当前页"];
    const scanScope = scannedPages.length > 1 ? `${scannedPages.length} 个分页` : "当前页";
    const candidateState = pendingAssignments.length ? "采集到" : "确认无数据";
    return {
      acquisitionState: signals.courseContext ? candidateState : "未获取",
      candidateState,
      reason: signals.courseContext
        ? (pendingAssignments.length ? `已完成${scanScope}目标班级的只读扫描。` : `已完成${scanScope}目标班级的只读扫描，未发现待批作业。`)
        : "已识别作业列表和班级范围，等待同标签页课程上下文核验。",
      signals,
      scopeVerified: true,
      scannedPages,
      pendingAssignments,
      assignmentDeadlines: assignments.filter((item) => item.deadline).map(({ title, className, deadline, page }) => ({ title, className, deadline, page })),
      classSummary: classNames.map((className) => {
        const items = assignments.filter((item) => item.className === className);
        return { className, pendingTotal: items.reduce((total, item) => total + item.pending, 0), assignmentCount: items.length };
      }),
    };
  }

  globalThis.LearningTongAssignmentScan = { normalize, deadlineOf, scanSnapshot };
})();
