export const DEMO_MODE_STORE_KEY = "learningtong-teaching-operations-demo-mode-v1";

export function demoCourseFor(course) {
  const index = { aigc: "01", nlp: "02", ml: "03" }[course.key] ?? "01";
  return { ...course, name: `教学运营演示课程 ${index}`, classNames: ["演示班 A", "演示班 B"], connection: "演示模式" };
}

const readOnlyTemplates = {
  scan: { taskName: "扫描待批作业", state: "已采集", risk: "R1 · 只读", evidence: "作业列表页 · 2 页已复核", summary: "已汇总白名单班级的待批作业，不含学生姓名或提交内容。", metrics: [["待批作业", "3 项"], ["已核验班级", "2 个"], ["扫描页面", "2 页"]], rows: [["演示班 A", "2 项待批", "2 个作业"], ["演示班 B", "1 项待批", "1 个作业"]] },
  "chapter-scan": { taskName: "查看待批测试", state: "确认无数据", risk: "R1 · 只读", evidence: "章节测试列表 · 班级范围已核验", summary: "已完成演示班级的测试待批检查，当前范围内没有待处理测试。", metrics: [["待批测试", "0 项"], ["已核验班级", "2 个"], ["异常项", "0 项"]], rows: [["演示班 A", "无待批", "范围已核验"], ["演示班 B", "无待批", "范围已核验"]] },
  "attendance-scan": { taskName: "采集签到异常", state: "已采集", risk: "R1 · 只读", evidence: "签到统计页 · 活动范围已核验", summary: "已生成演示异常汇总，只显示汇总数量，不显示学生身份信息。", metrics: [["签到活动", "2 个"], ["异常记录", "2 条"], ["已核验班级", "2 个"]], rows: [["演示班 A", "1 条异常", "活动 1"], ["演示班 B", "1 条异常", "活动 2"]] },
  score: { taskName: "查看成绩处理状态", state: "待人工复核", risk: "R1 · 只读", evidence: "成绩处理状态页 · 未写入", summary: "演示成绩数据存在待人工复核项，因此没有生成任何回填或修改动作。", metrics: [["待复核项", "1 项"], ["可写入项", "0 项"], ["已读取页面", "1 个"]], rows: [["演示班 A", "待复核", "缺少评分依据"], ["演示班 B", "无需处理", "仅供展示"]] },
  "chapter-result": { taskName: "查看测试结果", state: "已采集", risk: "R1 · 只读", evidence: "章节测试汇总页 · 演示数据", summary: "已生成脱敏测试结果概览。", metrics: [["已完成测试", "2 项"], ["待批测试", "0 项"], ["异常项", "0 项"]], rows: [["演示班 A", "已完成", "1 项"], ["演示班 B", "已完成", "1 项"]] },
  "attendance-result": { taskName: "查看考勤记录", state: "已采集", risk: "R1 · 只读", evidence: "签到汇总页 · 演示数据", summary: "已生成脱敏考勤汇总。", metrics: [["签到活动", "2 个"], ["异常记录", "2 条"], ["已核验班级", "2 个"]], rows: [["演示班 A", "1 条异常", "已脱敏"], ["演示班 B", "1 条异常", "已脱敏"]] },
};

export function createDemoReadResult(actionKey, course) {
  const template = readOnlyTemplates[actionKey] ?? readOnlyTemplates.scan;
  return { id: `demo-${Date.now()}`, courseName: course.name, classNames: course.classNames, ...template, createdAt: new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date()) };
}

export function createDemoWritePlan(actionKey, course) {
  const isDeadline = actionKey === "deadline";
  return {
    id: `demo-write-${Date.now()}`,
    actionKey,
    taskName: isDeadline ? "修改作业截止时间" : "开始批改",
    courseName: course.name,
    classNames: isDeadline ? [course.classNames[0]] : course.classNames,
    risk: isDeadline ? "R2 · 单项写入" : "R3 · 成绩写入",
    impact: isDeadline ? "只处理演示班 A 的《提示词练习》，共 1 项；演示班 B 不变" : "演示作业 3 份 · 不含学生身份信息",
    preview: isDeadline ? "《提示词练习》原截止时间：2026-09-18 23:59；拟修改为：2026-09-20 23:59" : "评分依据：已确认的演示量规；拟写入：3 份演示成绩",
  };
}

export function createDemoWriteResult(plan) {
  return {
    id: `${plan.id}-result`, taskName: plan.taskName, courseName: plan.courseName, classNames: plan.classNames,
    state: "演示回读通过", risk: plan.risk, evidence: "写前预演 → 二次确认 → 模拟写入 → 独立回读", summary: "这是脱敏演示链路，没有连接学习通，也没有修改任何真实数据。",
    metrics: [["预演范围", plan.impact], ["写入状态", "模拟完成"], ["独立回读", "通过"]],
    rows: plan.actionKey === "deadline" ? [["演示班 A · 提示词练习", "2026-09-20 23:59", "模拟重新读取：与目标一致"], ["演示班 B", "不变", "不在本次处理范围"]] : [["写前预演", "范围已确认", "演示"], ["模拟写入", "已完成", "演示"], ["独立回读", "通过", "演示"]],
    createdAt: new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date()),
  };
}

export function createDemoRunRecord(result) {
  return { id: result.id, taskName: result.taskName, courseName: result.courseName, classNames: result.classNames, state: result.state, detail: `${result.risk} · ${result.summary}`, createdAt: result.createdAt };
}

export function buildDemoReport(records) {
  const items = records.slice(0, 8).map((record) => `| ${record.createdAt} | ${record.taskName} | ${record.courseName} | ${record.state} | ${record.detail} |`).join("\n");
  return `# 学习通教学运营自动化系统｜脱敏运行报告\n\n> 本报告为本机演示数据，不连接学习通，不包含账号、课程 ID、CPI、Cookie、学生姓名、成绩或链接。\n\n## 演示范围\n\n- 模式：本地脱敏演示\n- 任务入口：按钮与 AI 对话\n- 风险控制：默认只读；写入任务展示预演、确认与独立回读\n\n## 最近演示任务\n\n| 时间 | 任务 | 课程 | 状态 | 摘要 |\n| --- | --- | --- | --- | --- |\n${items || "| 暂无 | 暂无 | 暂无 | 暂无 | 暂无 |"}\n\n## 架构要点\n\n浏览器工作台 → 本机任务网关 → 课程配置与风险门禁 → 受控浏览器/本地脚本适配器 → 审计留痕。\n\n所有真实任务须通过本轮登录、课程、班级与页面结构核验；采集失败显示“未获取”，不误报为“确认无数据”。\n`;
}

export function buildArchitectureSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="520" viewBox="0 0 1200 520"><style>text{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;fill:#17202d}.t{font-size:26px;font-weight:700}.s{font-size:18px;fill:#50647e}.b{fill:#fff;stroke:#cfd9e6;stroke-width:2}.a{fill:#e8f0ff;stroke:#1261d4;stroke-width:2}.l{stroke:#8ca1bb;stroke-width:3;marker-end:url(#m)}</style><defs><marker id="m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8ca1bb"/></marker></defs><text x="60" y="62" class="t">学习通教学运营自动化系统（本机脱敏演示架构）</text><rect x="60" y="150" width="230" height="150" rx="16" class="a"/><text x="105" y="210" class="t">教师工作台</text><text x="91" y="245" class="s">按钮 · AI 对话 · 结果</text><line x1="290" y1="225" x2="425" y2="225" class="l"/><rect x="430" y="150" width="260" height="150" rx="16" class="b"/><text x="478" y="210" class="t">本机任务网关</text><text x="470" y="245" class="s">白名单 · 配置 · 审计</text><line x1="690" y1="225" x2="825" y2="225" class="l"/><rect x="830" y="120" width="300" height="210" rx="16" class="b"/><text x="890" y="185" class="t">受控执行层</text><text x="880" y="220" class="s">课程门禁 · 页面策略</text><text x="880" y="250" class="s">Ego 浏览器 · 本地脚本</text><text x="880" y="280" class="s">预演 · 确认 · 回读</text><text x="60" y="410" class="s">默认只读；不绕过登录、验证码或权限；演示模式不连接真实课程。</text></svg>`;
}

export function downloadArtifact(filename, contents, mimeType) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}
