(() => {
  const demoCourse = (course, index = 0) => ({ ...course, name: `教学运营演示课程 ${String(index + 1).padStart(2, "0")}`, classNames: ["演示班 A", "演示班 B"] });

  const payloads = {
    pending: { acquisitionState: "采集到", reason: "脱敏演示：已扫描 2 个分页，发现 3 项待批。", assignmentTotal: 3, scannedPages: ["1", "2"], pendingAssignments: [{ title: "演示任务一", className: "演示班 A", pending: 2 }, { title: "演示任务二", className: "演示班 B", pending: 1 }], classSummary: [{ className: "演示班 A", pendingTotal: 2, assignmentCount: 1 }, { className: "演示班 B", pendingTotal: 1, assignmentCount: 1 }] },
    deadlines: { acquisitionState: "采集到", reason: "脱敏演示：已生成 2 条作业截止时间清单。", assignmentTotal: 2, scannedPages: ["1"], assignmentDeadlines: [{ className: "演示班 A", title: "演示任务一", deadline: "09-01 08:00至 09-08 23:59" }, { className: "演示班 B", title: "演示任务二", deadline: "09-02 08:00至 09-09 23:59" }] },
    "chapter-tests": { acquisitionState: "确认无数据", reason: "脱敏演示：已核验 2 个班级，当前没有待批章节测试。", classSummary: [{ className: "演示班 A", pendingTotal: 0, testCount: 2 }, { className: "演示班 B", pendingTotal: 0, testCount: 2 }] },
    attendance: { acquisitionState: "采集到", reason: "脱敏演示：已生成签到异常汇总，不含学生身份。", classSummary: [{ className: "演示班 A", signActivityCount: 2, anomalyRecordCount: 1, complete: true, invalidIdentityRows: 0, statusCounts: { 迟到: 1 } }, { className: "演示班 B", signActivityCount: 2, anomalyRecordCount: 1, complete: true, invalidIdentityRows: 0, statusCounts: { 缺勤: 1 } }] },
    "score-overview": { acquisitionState: "采集到", reason: "脱敏演示：仅显示班级成绩汇总。", summary: { activeClass: "演示班 A", averageScore: 86, excellentCount: 24, passCount: 13, lowScoreCount: 3, studentCount: 40 } },
    "attendance-students": {
      acquisitionState: "采集到",
      reason: "脱敏演示：已生成签到学生明细（模拟数据，仅内存处理）。",
      signActivityCount: 2,
      anomalyStudentCount: 2,
      studentRecords: [
        { name: "演示学生一", username: "20260910001", className: "演示班 A", anomalyCount: 2, anomalySummary: "迟到×1、缺勤×1" },
        { name: "演示学生二", username: "20260910002", className: "演示班 A", anomalyCount: 0, anomalySummary: "" },
        { name: "演示学生三", username: "20260910003", className: "演示班 A", anomalyCount: 1, anomalySummary: "事假×1" },
        { name: "演示学生四", username: "20260910004", className: "演示班 B", anomalyCount: 0, anomalySummary: "" },
        { name: "演示学生五", username: "20260910005", className: "演示班 B", anomalyCount: 1, anomalySummary: "迟到×1" },
        { name: "演示学生六", username: "20260910006", className: "演示班 B", anomalyCount: 0, anomalySummary: "" },
      ],
    },
    "score-students": {
      acquisitionState: "采集到",
      reason: "脱敏演示：已生成成绩明细（模拟数据，仅内存处理）。",
      activeClass: "演示班 A",
      students: [
        { name: "演示学生一", username: "20260910001", score: 92 },
        { name: "演示学生二", username: "20260910002", score: 85 },
        { name: "演示学生三", username: "20260910003", score: 78 },
        { name: "演示学生四", username: "20260910004", score: 66 },
        { name: "演示学生五", username: "20260910005", score: 58 },
        { name: "演示学生六", username: "20260910006", score: 88 },
      ],
    },
    connection: { acquisitionState: "采集到", reason: "当前为脱敏演示模式，不连接学习通。", roleLabels: ["演示课程", "本机模拟数据"] },
  };

  function result(view) { return structuredClone(payloads[view] || payloads.pending); }
  function deadlinePreview(request) { return { acquisitionState: "待确认", reason: "脱敏演示：已唯一定位演示作业；确认后只生成模拟回读，不连接学习通。", confirmationToken: `demo:${crypto.randomUUID()}`, preview: { courseName: request.courseName, className: request.className, title: request.title, beforeEndTime: "2026-09-05 23:59:00", nextEndTime: request.nextEndTime } }; }
  function deadlineResult(request) { return { acquisitionState: "演示回读通过", reason: "已完成预演、确认、模拟写入和独立模拟回读；未连接学习通。", verification: { title: request?.title || "演示作业", className: request?.className || "演示班 A", nextEndTime: request?.nextEndTime || "", listDeadline: request?.nextEndTime || "" } }; }

  function architectureSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="520" viewBox="0 0 1200 520"><style>text{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;fill:#17202d}.t{font-size:26px;font-weight:700}.s{font-size:18px;fill:#50647e}.b{fill:#fff;stroke:#cfd9e6;stroke-width:2}.a{fill:#e8f0ff;stroke:#1261d4;stroke-width:2}.l{stroke:#8ca1bb;stroke-width:3}</style><rect width="1200" height="520" fill="#f7f9fc"/><text x="60" y="62" class="t">学习通教学运营自动化系统（脱敏演示架构）</text><rect x="60" y="150" width="230" height="150" rx="16" class="a"/><text x="105" y="210" class="t">教师扩展</text><text x="91" y="245" class="s">按钮 · AI 对话 · 结果</text><line x1="290" y1="225" x2="425" y2="225" class="l"/><rect x="430" y="150" width="260" height="150" rx="16" class="b"/><text x="478" y="210" class="t">风险与任务门禁</text><text x="470" y="245" class="s">白名单 · 预演 · 审计</text><line x1="690" y1="225" x2="825" y2="225" class="l"/><rect x="830" y="120" width="300" height="210" rx="16" class="b"/><text x="890" y="185" class="t">本机执行层</text><text x="880" y="220" class="s">课程门禁 · 页面策略</text><text x="880" y="250" class="s">浏览器扩展 · 脚本仓库</text><text x="880" y="280" class="s">确认 · 写入 · 独立回读</text><text x="60" y="410" class="s">默认只读；演示模式不连接真实课程，不包含学生数据或平台标识。</text></svg>`;
  }

  globalThis.LearningTongDemoMode = { demoCourse, result, deadlinePreview, deadlineResult, architectureSvg };
})();
