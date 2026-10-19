(() => {
  const core = globalThis.LearningTongScoreOverviewScan;
  if (!core) return;

  function courseLabel() {
    if (location.pathname === "/mooc2-ans/mycourse/tch") return document.title;
    if (location.pathname === "/stat2-vue/stat") return (document.body?.innerText || "").split(/\n+/).map(core.normalize).find(Boolean) || "";
    return "";
  }

  function snapshotScoreOverview(profile) {
    const bodyText = document.body?.innerText || "";
    const scoreRole = location.hostname === "stat2-ans.chaoxing.com"
      && location.pathname === "/score-data/index"
      && /综合成绩平均分/.test(bodyText)
      && /100≥学生成绩≥80/.test(bodyText);
    return {
      title: document.title,
      path: location.pathname,
      courseLabel: courseLabel(),
      scoreRole,
      summary: scoreRole ? core.parseSummary(bodyText, profile?.classNames || []) : undefined,
    };
  }

  function tableRowsToMatrix() {
    const tables = [...document.querySelectorAll("table")];
    for (const table of tables) {
      const rows = [...table.querySelectorAll("tr")]
        .map((tr) => [...tr.querySelectorAll("th,td")].map((cell) => cell.innerText || ""));
      if (rows.some((row) => row.some((text) => /姓名/.test(String(text))))) return rows;
    }
    return [];
  }

  async function scanScoreStudents(profile) {
    const snapshot = snapshotScoreOverview(profile);
    if (!snapshot.scoreRole) {
      return { acquisitionState: "未获取", reason: "当前页面不是学生成绩页，请先在课程内打开“统计 → 学生成绩”。" };
    }
    const parsed = core.parseStudentTable(tableRowsToMatrix());
    if (!parsed.complete) {
      return { acquisitionState: "未获取", reason: `${parsed.reason}如页面尚未加载完成，请稍后重试。` };
    }
    return {
      acquisitionState: "采集到",
      reason: `已读取当前班级 ${parsed.students.length} 名学生的综合成绩（仅在本机内存中用于填表，不保存）。`,
      activeClass: snapshot.summary?.activeClass || "",
      students: parsed.students,
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "inspect-score-overview-frame") {
      sendResponse(snapshotScoreOverview(message.profile || {}));
      return undefined;
    }
    if (message?.type === "scan-score-students") {
      scanScoreStudents(message.profile || {}).then(sendResponse);
      return true;
    }
    return undefined;
  });
})();
