(() => {
  const STORE_KEY = "lastScans";
  const TASK_LABELS = {
    "assignment-pending": "作业待批扫描",
    "assignment-deadlines": "截止时间清单",
    chapter: "章节测试待批",
    attendance: "签到异常扫描",
    "course-overview": "课程概览",
    score: "成绩概览",
    "chapter-structure": "章节结构检查",
  };
  const MESSAGE_TASK_KEYS = {
    "scan-active-assignment-page": "assignment-pending",
    "scan-active-assignment-deadlines": "assignment-deadlines",
    "scan-active-chapter-tests": "chapter",
    "scan-active-attendance": "attendance",
    "scan-active-course-overview": "course-overview",
    "scan-active-score-overview": "score",
    "scan-active-chapter-structure": "chapter-structure",
  };

  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function courseKeyOf(courseName) {
    const key = normalize(courseName);
    return key || "(未命名课程)";
  }

  function pendingTotalOf(payload) {
    return (payload?.pendingAssignments || []).reduce((sum, item) => sum + Number(item?.pending || 0), 0);
  }

  function scanSummaryFor(taskKey, payload) {
    const state = payload?.acquisitionState || "";
    if (state === "正在扫描" || state === "正在读取" || state === "正在提交") return undefined;
    if (taskKey === "assignment-pending") {
      if (state === "采集到") return `待批 ${pendingTotalOf(payload)} 项（共 ${payload.assignmentTotal || 0} 个作业）`;
      if (state === "确认无数据") return "白名单班级暂无待批作业";
    }
    if (taskKey === "assignment-deadlines" && state === "采集到") return `采集 ${payload.assignmentDeadlines?.length || 0} 个作业的截止时间`;
    const reason = normalize(payload?.reason);
    return reason ? reason.slice(0, 60) : undefined;
  }

  function mergeLastScan(store, { courseName, taskKey, at, state, summary, pendingTotal }) {
    if (!taskKey || !Number.isFinite(at) || !state) return store || {};
    const courseKey = courseKeyOf(courseName);
    const next = { ...(store || {}) };
    next[courseKey] = {
      ...(next[courseKey] || {}),
      [taskKey]: {
        at,
        state,
        ...(summary ? { summary } : {}),
        ...(Number.isFinite(pendingTotal) ? { pendingTotal } : {}),
      },
    };
    return next;
  }

  function lastScanOf(store, courseName, taskKey) {
    return store?.[courseKeyOf(courseName)]?.[taskKey] || undefined;
  }

  function relativeTimeText(at, now = Date.now()) {
    const timestamp = Number(at);
    if (!Number.isFinite(timestamp)) return "";
    const diff = now - timestamp;
    if (diff < 0) return "";
    if (diff < 60 * 1000) return "刚刚";
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))} 小时前`;
    const date = new Date(timestamp);
    const sameYear = date.getFullYear() === new Date(now).getFullYear();
    const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    return sameYear ? `${date.getMonth() + 1}月${date.getDate()}日 ${clock}` : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function badgeTextFor(pendingTotal) {
    const total = Number(pendingTotal);
    if (!Number.isFinite(total) || total <= 0) return "";
    return total > 99 ? "99+" : String(total);
  }

  globalThis.LearningTongScanCache = Object.freeze({
    STORE_KEY,
    TASK_LABELS,
    MESSAGE_TASK_KEYS,
    normalize,
    courseKeyOf,
    pendingTotalOf,
    scanSummaryFor,
    mergeLastScan,
    lastScanOf,
    relativeTimeText,
    badgeTextFor,
  });
})();
